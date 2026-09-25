import Schema from "@deepseek-ai/schemastery";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { defineTool } from "@deepseek-ai/dsh-tools";
//#region src/config.ts
const Config = Schema.object({
	pythonBin: Schema.string().default(""),
	mirobodyHome: Schema.string().default(""),
	mcpUrl: Schema.string().default(""),
	mcpToken: Schema.string().default(""),
	timeoutMs: Schema.number().default(3e4)
});
//#endregion
//#region src/engine.ts
const PYTHON_CANDIDATES = [
	"python3.14",
	"python3.13",
	"python3.12",
	"python3"
];
function bridgePath() {
	return join(dirname(fileURLToPath(import.meta.url)), "..", "bridge", "dsh_bridge.py");
}
function discoverPython(configured) {
	const explicit = configured.trim() || process.env.MIROBODY_PYTHON?.trim() || "";
	if (explicit) return explicit;
	for (const bin of PYTHON_CANDIDATES) {
		const found = spawnSync("/usr/bin/which", [bin], { encoding: "utf8" });
		const path = found.stdout.trim();
		if (found.status === 0 && path && existsSync(path)) return path;
	}
	return "python3";
}
/**
* The whole environment of the Python bridge. Never the harness's own (API keys, tokens, provider
* settings): only what a Python process needs to start (PATH, HOME, locale, TMPDIR) and what
* bridge/dsh_bridge.py reads (MIROBODY_HOME, the optional source checkout it puts on sys.path).
* PYTHONNOUSERSITE=1 keeps ~/.local site-packages out, so mirobody must be installed in the
* interpreter's own site-packages (a venv); PYTHONPATH is not passed, mirobodyHome is the way to add
* a checkout. Not a sandbox.
*/
function bridgeEnv(home) {
	const env = {
		PATH: process.env.PATH ?? "",
		HOME: process.env.HOME ?? "",
		LANG: process.env.LANG || "C.UTF-8",
		MIROBODY_HOME: home.trim(),
		PYTHONNOUSERSITE: "1",
		PYTHONDONTWRITEBYTECODE: "1"
	};
	for (const name of ["LC_ALL", "TMPDIR"]) {
		const value = process.env[name];
		if (value) env[name] = value;
	}
	return env;
}
function parseBridge(stdout, stderr, status) {
	const text = stdout.trim();
	if (text) try {
		const parsed = JSON.parse(text);
		if (parsed && typeof parsed === "object") return parsed;
	} catch {}
	const detail = (stderr || text || "mirobody bridge produced no JSON").slice(0, 500);
	return {
		ok: false,
		success: false,
		error_kind: status === null ? "unavailable" : "internal",
		error: detail,
		hint: "The Python bridge did not return JSON. Check pythonBin and that `pip install mirobody` used Python 3.12+."
	};
}
function runBridgeSync(python, home, payload, timeoutMs) {
	const script = bridgePath();
	if (!existsSync(script)) return {
		ok: false,
		success: false,
		error_kind: "internal",
		error: `bridge missing at ${script}`
	};
	const result = spawnSync(python, [script], {
		input: JSON.stringify(payload),
		encoding: "utf8",
		timeout: timeoutMs,
		env: bridgeEnv(home)
	});
	if (result.error && result.error.code === "ETIMEDOUT") return {
		ok: false,
		success: false,
		error_kind: "unavailable",
		error: "mirobody bridge timed out",
		hint: "The LOINC bundle can be slow on first load. Raise timeoutMs."
	};
	if (result.error && result.error.code === "ENOENT") return {
		ok: false,
		success: false,
		error_kind: "unavailable",
		error: `python not found: ${python}`,
		hint: "Set pythonBin to a Python 3.12+ interpreter that can import mirobody."
	};
	return parseBridge(result.stdout ?? "", result.stderr ?? "", result.status);
}
function runBridge(python, home, payload, timeoutMs) {
	return new Promise((resolve) => {
		const script = bridgePath();
		if (!existsSync(script)) {
			resolve({
				ok: false,
				success: false,
				error_kind: "internal",
				error: `bridge missing at ${script}`
			});
			return;
		}
		const child = spawn(python, [script], {
			env: bridgeEnv(home),
			stdio: [
				"pipe",
				"pipe",
				"pipe"
			]
		});
		const stdout = [];
		const stderr = [];
		let settled = false;
		const finish = (value) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve(value);
		};
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			finish({
				ok: false,
				success: false,
				error_kind: "unavailable",
				error: "mirobody bridge timed out",
				hint: "The LOINC bundle can be slow on first load. Raise timeoutMs."
			});
		}, timeoutMs);
		child.stdout.on("data", (chunk) => stdout.push(chunk));
		child.stderr.on("data", (chunk) => stderr.push(chunk));
		child.on("error", (error) => {
			finish({
				ok: false,
				success: false,
				error_kind: "unavailable",
				error: error.code === "ENOENT" ? `python not found: ${python}` : error.message,
				hint: "Set pythonBin to a Python 3.12+ interpreter that can import mirobody."
			});
		});
		child.on("close", (status) => {
			finish(parseBridge(Buffer.concat(stdout).toString("utf8"), Buffer.concat(stderr).toString("utf8"), status));
		});
		child.stdin.end(JSON.stringify(payload));
	});
}
//#endregion
//#region src/version.ts
const PRODUCT_VERSION = "1.0.1";
const PRODUCT_NAME = "dsh-plugin-mirobody";
const TOOL_NAMES = [
	"resolve_indicator",
	"resolve_reading",
	"convert_unit",
	"normalize_unit",
	"query_health_indicators",
	"query_medications",
	"query_genetic_data",
	"mirobody_status"
];
//#endregion
//#region src/mcp.ts
function endpoint(raw) {
	try {
		const url = new URL(raw.trim());
		if (url.protocol !== "http:" && url.protocol !== "https:") return null;
		return url;
	} catch {
		return null;
	}
}
function mcpHost(raw) {
	const url = endpoint(raw);
	return url ? url.host : "";
}
function parseBody(text) {
	const trimmed = text.trim();
	if (!trimmed) throw new Error("empty MCP response");
	if (trimmed.startsWith("{") || trimmed.startsWith("[")) return JSON.parse(trimmed);
	const payloads = [];
	for (const line of trimmed.split("\n")) {
		if (!line.startsWith("data:")) continue;
		const payload = line.slice(5).trim();
		if (payload && payload !== "[DONE]") payloads.push(payload);
	}
	if (payloads.length === 0) throw new Error("MCP response had no JSON or SSE data");
	return JSON.parse(payloads[payloads.length - 1] ?? "");
}
function unwrap(message) {
	if (!message || typeof message !== "object") return {
		success: false,
		error_kind: "internal",
		error: "MCP response was not an object"
	};
	const body = message;
	if (body.error) {
		const denied = body.error.code === -32e3 || /auth/i.test(body.error.message ?? "");
		return {
			success: false,
			error_kind: denied ? "denied" : "internal",
			error: body.error.message || "MCP error",
			code: body.error.code,
			hint: denied ? "Mirobody refused this call. Set mcpToken to the account JWT, or paste the personal MCP URL from Settings → MCP." : "The Mirobody MCP server returned an error. Do not invent the missing record."
		};
	}
	const structured = body.result?.structuredContent;
	if (structured !== void 0) return {
		success: true,
		result: structured
	};
	const content = body.result?.content;
	if (Array.isArray(content)) {
		const text = content.filter((block) => block.type === "text").map((block) => block.text ?? "").join("\n");
		if (!text) return {
			success: true,
			result: body.result
		};
		try {
			return {
				success: true,
				result: JSON.parse(text)
			};
		} catch {
			return {
				success: true,
				text
			};
		}
	}
	return {
		success: true,
		result: body.result ?? message
	};
}
async function postJson(url, token, body, session, timeoutMs) {
	const headers = {
		"content-type": "application/json",
		accept: "application/json, text/event-stream",
		"mcp-protocol-version": "2025-06-18"
	};
	if (token.trim()) headers.authorization = `Bearer ${token.trim()}`;
	if (session) headers["mcp-session-id"] = session;
	const response = await fetch(url, {
		method: "POST",
		headers,
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(timeoutMs)
	});
	const nextSession = response.headers.get("mcp-session-id") ?? session;
	return {
		status: response.status,
		session: nextSession,
		text: await response.text()
	};
}
async function callMcpTool(options) {
	const target = endpoint(options.url);
	if (!target) return {
		success: false,
		error_kind: "unavailable",
		error: "mcpUrl is empty or not http(s)",
		hint: "Run Mirobody (`./deploy.sh`, default http://127.0.0.1:18060/mcp) and set mcpUrl. Record tools do not read a database inside DSH."
	};
	const url = target.toString();
	try {
		const init = await postJson(url, options.token, {
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: {
				protocolVersion: "2025-06-18",
				capabilities: {},
				clientInfo: {
					name: PRODUCT_NAME,
					version: PRODUCT_VERSION
				}
			}
		}, "", options.timeoutMs);
		if (init.status === 401 || init.status === 403) return {
			success: false,
			error_kind: "denied",
			error: `MCP HTTP ${init.status}`,
			hint: "Set mcpToken to a Mirobody JWT, or use the personal MCP URL from Settings → MCP. Terminology tools do not need this."
		};
		let session = init.session;
		if (session) await postJson(url, options.token, {
			jsonrpc: "2.0",
			method: "notifications/initialized"
		}, session, options.timeoutMs).catch(() => void 0);
		const call = await postJson(url, options.token, {
			jsonrpc: "2.0",
			id: 2,
			method: "tools/call",
			params: {
				name: options.name,
				arguments: options.args
			}
		}, session, options.timeoutMs);
		if (call.status === 401 || call.status === 403) return {
			success: false,
			error_kind: "denied",
			error: `MCP HTTP ${call.status}`,
			hint: "The Mirobody account token was rejected."
		};
		return unwrap(parseBody(call.text));
	} catch (error) {
		const timedOut = error instanceof Error && error.name === "TimeoutError";
		return {
			success: false,
			error_kind: timedOut ? "unavailable" : "internal",
			error: error instanceof Error ? error.message : "MCP call failed",
			hint: timedOut ? "The Mirobody server did not answer before timeoutMs." : "Could not reach mcpUrl. Confirm the server is up. Do not fill the gap with guessed labs."
		};
	}
}
//#endregion
//#region src/commands.ts
function argsOf(raw, name) {
	const text = raw.trim().replace(/^\//, "");
	if (text === name) return "";
	if (text.startsWith(`${name} `)) return text.slice(name.length).trim();
	return text;
}
function registerCommands(ctx, config) {
	ctx.inject(["commands"], (scoped) => {
		scoped.commands.register({
			name: "mirobody",
			description: "打印 Mirobody 引擎是否可导入，以及记录服务器是否已配置（不含 token）。",
			handler: () => {
				const current = config();
				const status = runBridgeSync(discoverPython(current.pythonBin), current.mirobodyHome, { op: "status" }, current.timeoutMs);
				const lines = [
					`${PRODUCT_NAME} ${PRODUCT_VERSION}`,
					status.ok ? `engine ${status.version ?? "unknown"}  bundle ${status.bundle ?? "unknown"}  python ${status.python ?? ""}` : `engine unavailable: ${status.error ?? "unknown"}`,
					current.mcpUrl.trim() ? `mcp host ${mcpHost(current.mcpUrl) || "(unparsed)"}  token ${current.mcpToken.trim() ? "set" : "empty"}` : "mcp not configured — record tools need mcpUrl"
				];
				return {
					kind: status.ok ? "success" : "error",
					text: lines.join("\n")
				};
			}
		});
		scoped.commands.register({
			name: "mirobody-resolve",
			description: "用离线引擎解析一个或多个指标名。例：/mirobody-resolve 血红蛋白 血脂",
			handler: (invocation) => {
				const names = argsOf(invocation.rawInput, "mirobody-resolve").split(/\s+/).filter(Boolean).slice(0, 20);
				if (names.length === 0) return {
					kind: "error",
					text: "用法：/mirobody-resolve 血红蛋白 LDL"
				};
				const current = config();
				const result = runBridgeSync(discoverPython(current.pythonBin), current.mirobodyHome, {
					op: "resolve",
					names
				}, current.timeoutMs);
				return {
					kind: result.ok ? "success" : "error",
					text: JSON.stringify(result, null, 2)
				};
			}
		});
		scoped.commands.register({
			name: "mirobody-version",
			description: "打印 dsh-plugin-mirobody 版本。",
			handler: () => ({
				kind: "success",
				text: `${PRODUCT_NAME} ${PRODUCT_VERSION}`
			})
		});
	});
}
//#endregion
//#region src/guardrails.ts
const LABEL_KEYS = [
	"acute_emergency",
	"self_harm",
	"med_change_request"
];
function noLabels(reason = "") {
	return {
		acute_emergency: false,
		self_harm: false,
		med_change_request: false,
		reason
	};
}
/** Clauses: negation, family and history words count only inside their own clause. */
function clauses(text) {
	return text.split(/[。！!？?；;\n\r，,、：:]+|\.(?=\s|$)|\s+(?:but|however|although)\s+|但是|但|可是|然而/i).map((part) => part.trim()).filter(Boolean);
}
/** Sentences, keeping the question mark: 「阿司匹林，可以停吗」 is one request. */
function sentences(text) {
	return text.split(/(?<=[。！!？?；;\n\r])|(?<=\.)\s+/).map((part) => part.trim()).filter(Boolean);
}
const CJK = /[㐀-鿿]/;
const NEG_ZH = /[无没否未不非]/;
const NEG_ZH_KEEP = /不停|不断|不住|不了|不知道|不清楚|不舒服|不对劲|受不了/g;
const NEG_EN = /\b(?:no|not|without|never|denies|denied|deny|don'?t|do not|didn'?t|did not|haven'?t|have not|hasn'?t|isn'?t|wasn'?t|none|free of)\b/i;
function negatedBefore(clause, index) {
	const before = clause.slice(0, index);
	if (CJK.test(clause[index] ?? "")) return NEG_ZH.test(before.replace(NEG_ZH_KEEP, "").slice(-4));
	return NEG_EN.test(before);
}
const FAMILY = /父母|父亲|母亲|爸|妈|爷爷|奶奶|外公|外婆|姥姥|姥爷|祖父|祖母|兄弟|姐妹|哥哥|姐姐|弟弟|妹妹|叔叔|伯伯|姑姑|舅舅|阿姨|儿子|女儿|孩子|老公|老婆|丈夫|妻子|亲属|亲戚|家人|家里人|家族|家属|全家|家父|\b(?:family|father|mother|dad|mom|mum|parents?|brother|sister|grand(?:father|mother|pa|ma)|uncle|aunt|relatives?|husband|wife|son|daughter)\b/i;
const HISTORY = /风险|几率|概率|可能性|预防|降低|避免|史|既往|以前|之前|曾经|去年|前年|上个?月|上周|小时候|年轻时|年前|多年前|得过|患过|有过|犯过|发生过|去世|过世|体检|报告|化验|检查结果|心电图|会不会|算的是|指的是|\b(?:risk|history|historical|chance|probability|prevent\w*|reduce|lower|avoid|used to|(?:years?|months?|weeks?|days?) ago|last (?:year|month|week)|in the past|previously|score)\b/i;
const GENERIC = /是什么|什么原因|原因是|怎么回事|定义|症状有哪些|有哪些症状|\b(?:what (?:is|are|causes)|symptoms of)\b/i;
const NOW = /现在|正在|突然|刚才|刚刚|此刻|\bright now\b|\bjust now\b|\bi(?:'m| am)\b/i;
const AFTER = /^(?:过|史)|^[^，,。]{0,4}(?:不明显|已经?(?:好|缓解|消失)|好了|缓解了|消失了|没了)/;
const ACUTE = new RegExp([
	"胸痛",
	"胸口(?:剧烈)?(?:剧)?(?:痛|疼)",
	"心口(?:痛|疼)",
	"胸(?:口)?(?:压榨|压迫)(?:感|样)?",
	"胸闷得(?:厉害|要命|不行)",
	"胸闷[^，,。]{0,4}(?:出冷汗|喘不)",
	"呼吸困难",
	"喘不(?:上|过)(?:气|来)",
	"上不来气",
	"透不过气",
	"无法呼吸",
	"不能呼吸",
	"晕倒",
	"晕厥",
	"昏迷",
	"昏过去",
	"叫不醒",
	"意识不清",
	"不省人事",
	"抽搐",
	"大出血",
	"吐血",
	"咯血",
	"严重过敏",
	"过敏性休克",
	"喉咙[^，,。]{0,2}肿",
	"口角歪斜",
	"嘴(?:巴)?歪",
	"半身(?:麻木|不遂|无力)",
	"一侧(?:身体|手脚|肢体|手|腿|脸)?[^，,。]{0,2}(?:没力气|无力|麻木|不能动)",
	"说话不清",
	"口齿不清",
	"说不出话",
	"突然看不见",
	"(?:心梗|心肌梗死|心肌梗塞|中风|脑梗|脑卒中|卒中|脑出血)(?:了|发作|犯了)",
	"chest pain",
	"chest (?:is )?(?:tight|pressure|hurts?)",
	"can(?:no|')?t breathe",
	"can not breathe",
	"unable to breathe",
	"short of breath",
	"trouble breathing",
	"struggling to breathe",
	"fainted",
	"passed out",
	"unconscious",
	"not breathing",
	"seizure",
	"convulsing",
	"coughing (?:up )?blood",
	"vomiting blood",
	"bleeding heavily",
	"heavy bleeding",
	"anaphyla",
	"throat (?:is )?(?:closing|swelling)",
	"face (?:is )?drooping",
	"slurred speech",
	"(?:numb|weak) on one side",
	"one side of my (?:body|face)",
	"(?:i am|i'm|i think i'm|i think i am|i might be|i may be) having a (?:heart attack|stroke)"
].join("|"), "gi");
const BYSTANDER_NOW = /(?:突然|现在|正在|刚才|刚刚)[^，,。]{0,6}(?:说话不清|口齿不清|说不出话|嘴(?:巴)?歪|口角歪斜|一侧|半身|胸口|胸痛|喘不|呼吸困难|抽搐|晕倒|昏迷)/;
const BYSTANDER = /叫不醒|没有?呼吸了?|不呼吸了|没反应了?|没有反应|不省人事|昏迷|晕倒了|倒下了|抽搐|口吐白沫|\b(?:unconscious|not breathing|unresponsive|collapsed|won'?t wake up|having a seizure|having a (?:heart attack|stroke))\b/i;
const SELF_HARM = new RegExp([
	"自杀",
	"轻生",
	"割腕",
	"跳楼",
	"寻死",
	"不想活(?!到|过|成|得)",
	"(?<![不别怕])想死(?![你您他她它得的地])",
	"活着没(?:意思|意义)",
	"活不下去",
	"结束(?:自己的?)?生命",
	"伤害自己",
	"了结自己",
	"一死了之",
	"死了算了",
	"suicid",
	"kill myself",
	"end(?:ing)? my life",
	"end(?:ing)? it all",
	"want to die",
	"wanna die",
	"don'?t want to (?:live|be alive)",
	"hurt myself",
	"self[- ]harm",
	"better off dead"
].join("|"), "gi");
const SELF_HARM_CONTEXT = /风险|研究|论文|统计|数据|评估|预防|以前|曾经|过去|\b(?:risk|stud(?:y|ies)|rates?|prevent\w*|research|used to|in the past)\b/i;
function acuteIn(clause) {
	const lower = clause.toLowerCase();
	if (HISTORY.test(lower)) return false;
	if (GENERIC.test(lower) && !NOW.test(lower)) return false;
	if (FAMILY.test(lower)) {
		const hit = BYSTANDER.exec(lower) ?? BYSTANDER_NOW.exec(lower);
		return !!hit && !negatedBefore(lower, hit.index) && !AFTER.test(lower.slice(hit.index + hit[0].length));
	}
	for (const hit of lower.matchAll(ACUTE)) {
		const index = hit.index ?? 0;
		if (negatedBefore(lower, index)) continue;
		if (AFTER.test(lower.slice(index + hit[0].length))) continue;
		return true;
	}
	return false;
}
function selfHarmIn(clause) {
	const lower = clause.toLowerCase();
	if (FAMILY.test(lower) || SELF_HARM_CONTEXT.test(lower)) return false;
	for (const hit of lower.matchAll(SELF_HARM)) {
		if (negatedBefore(lower, hit.index ?? 0)) continue;
		return true;
	}
	return false;
}
const DRUGS = [
	"二甲双胍",
	"阿司匹林",
	"雷帕霉素",
	"西罗莫司",
	"他汀",
	"阿托伐他汀",
	"瑞舒伐他汀",
	"辛伐他汀",
	"降压药",
	"降糖药",
	"降脂药",
	"胰岛素",
	"司美格鲁肽",
	"替尔泊肽",
	"利拉鲁肽",
	"阿卡波糖",
	"达格列净",
	"恩格列净",
	"华法林",
	"氯吡格雷",
	"左甲状腺素",
	"优甲乐",
	"激素",
	"泼尼松",
	"地塞米松",
	"褪黑素",
	"安眠药",
	"抗抑郁药",
	"达沙替尼",
	"槲皮素",
	"非瑟酮",
	"白藜芦醇",
	"氨氯地平",
	"硝苯地平",
	"缬沙坦",
	"氯沙坦",
	"厄贝沙坦",
	"美托洛尔",
	"比索洛尔",
	"依那普利",
	"氢氯噻嗪",
	"格列美脲",
	"西格列汀",
	"布洛芬",
	"对乙酰氨基酚",
	"奥美拉唑",
	"叶酸",
	"钙片",
	"益生菌",
	"姜黄素",
	"睾酮",
	"雌激素",
	"nmn",
	"nr",
	"烟酰胺核糖",
	"烟酰胺单核苷酸",
	"亚精胺",
	"尿石素",
	"辅酶q10",
	"维生素d",
	"维生素",
	"鱼油",
	"补剂",
	"保健品",
	"metformin",
	"aspirin",
	"rapamycin",
	"sirolimus",
	"statins?",
	"atorvastatin",
	"rosuvastatin",
	"insulin",
	"semaglutide",
	"tirzepatide",
	"acarbose",
	"warfarin",
	"clopidogrel",
	"levothyroxine",
	"prednisone",
	"melatonin",
	"dasatinib",
	"amlodipine",
	"quercetin",
	"fisetin",
	"resveratrol",
	"spermidine",
	"urolithin",
	"coq10",
	"vitamin d",
	"fish oil",
	"omega-3",
	"ozempic"
];
const DRUG_SUFFIX = /地平|沙坦|普利|洛尔|他汀|双胍|格列|列净|列汀|鲁肽|泊肽|替尼|霉素|西林|沙星|拉唑|噻嗪|匹林|洛芬|西泮|唑仑|曲坦|莫司|替丁|司琼|膦酸|肝素|格雷/;
const NOT_MEDICINE = /淮?山药|芍药|药膳|药食同源|药用价值|农药|火药|炸药|弹药|药材/g;
const MEDICINE_WORD = /药|处方|补剂|补充剂|保健品|营养素|维生素|维他命|\b(?:medications?|medicines?|meds|drugs?|pills?|tablets?|capsules?|supplements?|prescriptions?|vitamins?)\b/i;
function escapeRegExp(text) {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function nameHit(lower, name) {
	const item = name.toLowerCase();
	if (!item) return false;
	if (/^[a-z0-9 ?-]+$/.test(item)) return new RegExp(`(?<![a-z0-9])${item.includes("?") ? item : escapeRegExp(item)}(?![a-z0-9])`, "i").test(lower);
	return lower.includes(item);
}
/** Whether the text names a medicine or supplement: a generic word (not 山药), a known name, or a drug-name ending. */
function mentionsMedicine(text) {
	const lower = String(text ?? "").normalize("NFKC").toLowerCase().replace(NOT_MEDICINE, " ");
	if (MEDICINE_WORD.test(lower) || DRUG_SUFFIX.test(lower)) return true;
	return DRUGS.some((name) => nameHit(lower, name));
}
const ASK_CHANGE = /(?:可以|能|能不能|能否|要不要|该不该|应不应该|应该|需不需要|需要|可不可以|是否|用不用|还用|还要|还能|必须)(?:继续|再|先|马上|直接|自己|也)?(?:把[^，,。？?！!]{1,12})?(?:停|断|不吃|别吃|吃|服|换|加量|减量|加|减|调整|补|开始)/;
const CHANGE_ASKED = /(?:停掉|停用|停止|停了|停|不吃了?|别吃|换掉|减量|加量|减半)(?:的话)?(?:(?:可以|行|好|合适|没问题)?(?:吗|嘛|么|？|\?)|行不行|好不好|可不可以|可以不)/;
const INTENT_CHANGE = /(?:我想|我要|我打算|我准备|我决定|我考虑|想要|打算|准备|决定|考虑|帮我|给我|请你|请帮我?|麻烦你?)(?!到|记录|记一下|记下|保存|存下|存一下|打卡|上传|录入|整理|看|查|分析|解读|算|知道|了解|问|找|读|讲|说|介绍|解释)[^，,。？?！!]{0,12}?(?:停|断|不吃|别吃|开始吃|开始服|开始用|开始打|吃|服|用上|加上|加用|换|改|加量|减量|减|加|开|补|试)/;
const IMPERATIVE = /^(?:请|麻烦)?(?:帮我|给我)?(?:停掉|停用|停止|停|断掉|戒掉|换掉|减掉|开始吃|开始服用|加用|别吃)|把[^，,。？?！!]{1,15}?(?:停掉|停止|停用|换掉|换成|减掉|减量|加量|减半|加倍|停了?吧|不吃了?吧)|(?:停掉|停了|不吃了|换了|减了|停)吧/;
const PRESCRIBE = /(?:给我|帮我|能不能|能否|可以|可不可以|请|麻烦你?)[^，,。？?！!]{0,4}开(?!了|的|过|始|心|车|会|门|玩笑)|开(?:点|些|一些|一点)(?!了)/;
const PRESCRIBE_RECORD = /(?:医生|大夫|医院)[^，,。]{0,4}开(?:了|的|过)/;
const PRESCRIBE_RECORD_ALL = new RegExp(PRESCRIBE_RECORD.source, "g");
const EN_CHANGE = [
	/\b(?:can|could|may|should|shall) i (?:still )?(?:take|stop|start|quit|skip|continue|double|increase|decrease|reduce|come off|go off|switch)\b/i,
	/\b(?:want|going|plan(?:ning)?|need|trying|like|decided) to (?:stop|start|quit|come off|get off|take|switch|increase|decrease|reduce)\b/i,
	/^(?:please )?(?:stop|start|prescribe|switch|increase|decrease|reduce)\b/i,
	/\b(?:ok|okay|safe|fine|alright) (?:for me )?to (?:stop|start|quit|skip|take|come off)\b/i,
	/\bprescribe (?:me|something)\b|\bgive me (?:a |some )?(?:prescription|medication|meds|pills)\b/i,
	/\b(?:stop|quit|come off|get off) (?:taking )?(?:my |the )?\w/i
];
function medChangeIn(sentence) {
	const lower = sentence.toLowerCase();
	if (CJK.test(lower)) {
		const asked = lower.replace(PRESCRIBE_RECORD_ALL, "，");
		return ASK_CHANGE.test(asked) || CHANGE_ASKED.test(asked) || INTENT_CHANGE.test(asked) || IMPERATIVE.test(asked) || PRESCRIBE.test(asked) && !PRESCRIBE_RECORD.test(lower);
	}
	const howMuch = /\bhow (?:much|many|often)\b/.test(lower);
	return EN_CHANGE.some((pattern, index) => !(index === 0 && howMuch) && pattern.test(lower));
}
/**
* Labels from the rules. An emergency needs an acute sign that is not negated, not a family member's
* history, not past and not a risk question; self-harm needs real intent (not 我不想死, not
* 不想活到120岁); a medicine request needs a medicine (not 山药) and a request to start, stop or change it
* (not a record of what the person already did).
*/
function ruleLabels(input) {
	const text = String(input ?? "").normalize("NFKC").replace(/[‘’ʼ′]/g, "'").slice(0, 4e3);
	const labels = noLabels();
	if (!text.trim()) return labels;
	const parts = clauses(text);
	labels.acute_emergency = parts.some(acuteIn);
	labels.self_harm = parts.some(selfHarmIn);
	labels.med_change_request = mentionsMedicine(text) && sentences(text).some(medChangeIn);
	const hits = LABEL_KEYS.filter((key) => labels[key]);
	labels.reason = hits.length > 0 ? `rules: ${hits.join(", ")}` : "";
	return labels;
}
const EMERGENCY_REPLY_ZH = "如果您正在经历紧急不适，请立即拨打 120 或当地急救电话。在美国可拨打或发短信至 988。我不能替代急救，也不会给出处理步骤。";
const NO_MEDICATION_CHANGE_ZH = "我不能建议开始、停止、加量、减量或更换药物。用药记录只读。调整处方请联系开具该药的医生。";
const NOTE_HEAD = "[Mirobody safety note: added by the plugin, not written by the person. Follow it; never quote it as their words.]";
/** The one note appended after the person's words for what was flagged, or null. Emergencies and self-harm come first. */
function guidanceNote(labels) {
	const why = labels.reason ? ` (${labels.reason.slice(0, 120)})` : "";
	if (labels.acute_emergency || labels.self_harm) return {
		summary: "Mirobody 安全提示：可能是紧急情况，先提醒拨打 120",
		text: [
			NOTE_HEAD,
			labels.acute_emergency ? `The message above may describe emergency symptoms happening now${why}.` : `The message above may mean the person is thinking about harming themselves${why}.`,
			`Begin your reply with this, in their language: 「${EMERGENCY_REPLY_ZH}」`,
			"Stay kind and short. Call no record tools. Give no diagnosis, no dose and no treatment steps. If it is unclear whether it is happening now, still say this first, then ask."
		].join("\n")
	};
	if (labels.med_change_request) return {
		summary: "Mirobody 安全提示：涉及用药调整，不给建议",
		text: [
			NOTE_HEAD,
			`The message above asks to start, stop or change a medicine or its dose${why}.`,
			`Say this, in their language: 「${NO_MEDICATION_CHANGE_ZH}」`,
			"Do not advise it either way and give no dose. Reading their medication record back is fine. Answer the rest of the message normally."
		].join("\n")
	};
	return null;
}
/** The rules as one hit: an emergency (self-harm included) or a medicine change. */
function preGuard(text) {
	const labels = ruleLabels(text);
	if (labels.acute_emergency || labels.self_harm) return {
		code: "emergency",
		reply_zh: EMERGENCY_REPLY_ZH
	};
	if (labels.med_change_request) return {
		code: "no_medication_change",
		reply_zh: NO_MEDICATION_CHANGE_ZH
	};
	return null;
}
/** The guidance note text for a hit. The person's words are not repeated: the note is appended, not substituted. */
function wrapGuardMessage(_text, hit) {
	const labels = noLabels(hit.code);
	if (hit.code === "emergency") labels.acute_emergency = true;
	else labels.med_change_request = true;
	return guidanceNote(labels)?.text ?? "";
}
function extractUserText(content) {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content.map((block) => {
		if (block && typeof block === "object" && "type" in block && block.type === "text") return String(block.text ?? "");
		return "";
	}).join("\n");
}
/** What the person typed in this step: user-sourced messages only, never plugin notes or tool results. */
function personText(messages) {
	return messages.filter((message) => !message.source || message.source.kind === "user").map((message) => extractUserText(message.content)).filter((text) => text.trim()).join("\n");
}
//#endregion
//#region src/guard.ts
function noteMessage(note) {
	return Object.freeze({
		id: randomUUID(),
		role: "user",
		content: Object.freeze([Object.freeze({
			type: "text",
			text: note.text
		})]),
		source: Object.freeze({
			kind: "plugin",
			plugin: PRODUCT_NAME,
			form: "notice",
			summary: note.summary.slice(0, 120)
		})
	});
}
/**
* Call next() first and keep its decision. A rejection or an empty step passes through untouched; a flagged
* step gets one note appended after the claimed messages. Any failure here keeps the decision as it was.
*/
async function guardPreStep(payload, next) {
	const decision = await next();
	try {
		if (decision.kind !== "enter" || payload.signal?.aborted) return decision;
		const text = personText(payload.messages);
		if (!text.trim()) return decision;
		const note = guidanceNote(ruleLabels(text));
		if (!note) return decision;
		return {
			...decision,
			messages: [...decision.messages, noteMessage(note)]
		};
	} catch {
		return decision;
	}
}
//#endregion
//#region src/prompt.ts
function registerPrompt(ctx) {
	ctx.inject(["systemPrompt"], (scoped) => {
		scoped.systemPrompt.section({
			name: "mirobody:persona",
			order: 48,
			text: () => [
				`You are answering with Mirobody ${PRODUCT_VERSION}, a health-data engine inside DeepSeek Harness.`,
				"Terminology tools (resolve_indicator, resolve_reading, convert_unit, normalize_unit) are offline and deterministic. Record tools read a Mirobody server the user configured. You do not hold a second copy of their chart.",
				"Never invent a LOINC code, a lab value, a unit conversion, a medication, or a genotype. Unresolved, empty, and \"not on file\" are answers.",
				"A panel name such as 血脂 or blood pressure does not resolve to one code. Ask for the specific measurement.",
				"When a value and a unit are known, call resolve_reading. The unit changes the code.",
				"Never diagnose. Never say 患有 or 治愈. Never advise starting, stopping, increasing, decreasing, or switching a medicine or a dose.",
				"query_medications is read-only. A plan is not proof a dose was taken. A missing log row is not proof it was skipped.",
				"A missing rsID was not typed. That is not a negative result. Nearby variants are near by position only.",
				"If the user describes an emergency, tell them to call 120 (or local emergency services; 988 in the US) and stop.",
				"Reply in the user's language. Cite the code, unit, and file or tool result each number came from."
			].join("\n")
		});
	});
}
//#endregion
//#region src/routes.ts
function sendJson(res, status, body) {
	if (res.writableEnded) return;
	const text = JSON.stringify(body);
	res.statusCode = status;
	res.setHeader("Content-Type", "application/json; charset=utf-8");
	res.setHeader("Cache-Control", "no-store");
	res.end(text);
}
function sendText(res, status, text) {
	if (res.writableEnded) return;
	res.statusCode = status;
	res.setHeader("Content-Type", "text/plain; charset=utf-8");
	res.setHeader("Cache-Control", "no-store");
	res.end(text);
}
function queryNames(url) {
	if (!url) return [];
	return new URL(url, "http://127.0.0.1").searchParams.getAll("q").map((item) => item.trim()).filter(Boolean).slice(0, 20);
}
const CONNECTION_UNAVAILABLE = "mirobody: DeepSeek Harness connection service unavailable";
const WRITE_METHODS = /* @__PURE__ */ new Set([
	"POST",
	"PUT",
	"PATCH",
	"DELETE"
]);
/** application/json, with or without a charset or other parameters. */
function isJsonRequest(req) {
	const type = req.headers["content-type"];
	return typeof type === "string" && (type.split(";", 1)[0] ?? "").trim().toLowerCase() === "application/json";
}
/**
* DSH's exact routes skip the /api prefix route and its checks, so every Mirobody handler runs them itself,
* before anything else: no connection service, no route (503); then DSH's own rejection; then a write
* that is not JSON (415), which a page on another site could otherwise send without a preflight.
*/
function guardRoute(connection, handler) {
	return (req, res) => {
		const service = connection();
		if (!service) {
			sendText(res, 503, CONNECTION_UNAVAILABLE);
			return;
		}
		let rejection;
		try {
			rejection = service.requestRejection(req);
		} catch {
			rejection = 403;
		}
		if (rejection !== void 0) {
			sendText(res, rejection === 401 ? 401 : 403, rejection === 401 ? "unauthorized" : "forbidden");
			return;
		}
		if (WRITE_METHODS.has((req.method ?? "").toUpperCase()) && !isJsonRequest(req)) {
			sendText(res, 415, "content type must be application/json");
			return;
		}
		handler(req, res);
	};
}
function registerRoutes(ctx, config) {
	let lookup = null;
	ctx.inject(["connection"], (scoped) => {
		lookup = () => scoped.connection;
	});
	const connection = () => {
		try {
			const service = lookup?.();
			return service && typeof service.requestRejection === "function" ? service : null;
		} catch {
			return null;
		}
	};
	ctx.inject(["webServer"], (scoped) => {
		const web = { register: (route) => scoped.webServer.register({
			...route,
			handler: guardRoute(connection, route.handler)
		}) };
		web.register({
			kind: "exact",
			path: "/api/mirobody/status",
			handler: (_req, res) => {
				const current = config();
				const engine = runBridgeSync(discoverPython(current.pythonBin), current.mirobodyHome, { op: "status" }, current.timeoutMs);
				sendJson(res, 200, {
					product: PRODUCT_NAME,
					version: PRODUCT_VERSION,
					tools: TOOL_NAMES,
					engine,
					mcp: {
						configured: Boolean(current.mcpUrl.trim()),
						host: mcpHost(current.mcpUrl),
						token_set: Boolean(current.mcpToken.trim())
					}
				});
			}
		});
		web.register({
			kind: "exact",
			path: "/api/mirobody/resolve",
			handler: (req, res) => {
				const names = queryNames(req.url);
				if (names.length === 0) {
					sendJson(res, 400, {
						ok: false,
						error: "pass one or more q parameters"
					});
					return;
				}
				const current = config();
				const result = runBridgeSync(discoverPython(current.pythonBin), current.mirobodyHome, {
					op: "resolve",
					names
				}, current.timeoutMs);
				sendJson(res, result.ok ? 200 : 503, result);
			}
		});
		web.register({
			kind: "exact",
			path: "/api/mirobody/version",
			handler: (_req, res) => sendJson(res, 200, {
				product: PRODUCT_NAME,
				version: PRODUCT_VERSION
			})
		});
	});
}
//#endregion
//#region src/skills.ts
const SKILL_NAMES = [
	"terminology",
	"readings",
	"medications",
	"genetics"
];
function parseSkill(raw) {
	const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
	if (!match) throw new Error("SKILL.md missing frontmatter");
	const fm = match[1] ?? "";
	const content = (match[2] ?? "").trim();
	const name = fm.match(/^name:\s*(.+)$/m)?.[1]?.trim();
	const description = fm.match(/^description:\s*(.+)$/m)?.[1]?.trim();
	if (!name || !description) throw new Error("SKILL.md missing name/description");
	return {
		name,
		description,
		content
	};
}
function registerSkills(ctx) {
	ctx.inject(["skills"], (scoped) => {
		const root = join(dirname(fileURLToPath(import.meta.url)), "..", "skills");
		for (const dir of SKILL_NAMES) {
			const skill = parseSkill(readFileSync(join(root, dir, "SKILL.md"), "utf8"));
			scoped.skills.register({
				name: skill.name,
				description: skill.description,
				content: skill.content,
				source: "runtime",
				invocation: {
					modelInvocable: true,
					userInvocable: false
				}
			});
		}
	});
}
//#endregion
//#region src/json.ts
function asJson(value) {
	return value;
}
//#endregion
//#region src/validate.ts
const RESOLUTIONS = [
	"raw",
	"minute",
	"hour",
	"day",
	"week",
	"month"
];
const AGGREGATES = [
	"none",
	"stats",
	"latest"
];
const MED_VIEWS = [
	"plan",
	"log",
	"history"
];
const DISPATCH = /* @__PURE__ */ new Set([
	"raw|none",
	"raw|stats",
	"raw|latest",
	"minute|none",
	"minute|stats",
	"hour|none",
	"hour|stats",
	"day|none",
	"day|stats",
	"day|latest",
	"week|none",
	"week|stats",
	"week|latest",
	"month|none",
	"month|stats",
	"month|latest"
]);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
function present(value) {
	return value !== void 0 && value !== null && value !== "" && !(Array.isArray(value) && value.length === 0);
}
function rejectUnknown(args, allowed) {
	return Object.keys(args).filter((key) => !allowed.includes(key)).sort().map((parameter) => ({
		parameter,
		reason: "unknown parameter"
	}));
}
function rejectDates(args) {
	const out = [];
	for (const parameter of ["start", "end"]) {
		const value = args[parameter];
		if (present(value) && !DATE.test(String(value))) out.push({
			parameter,
			reason: "must be YYYY-MM-DD"
		});
	}
	return out;
}
function formatRejections(problems) {
	return problems.map((item) => `${item.parameter}: ${item.reason}`).join("; ");
}
function validateHealthQuery(args) {
	const out = rejectUnknown(args, [
		"keywords",
		"indicators",
		"start",
		"end",
		"resolution",
		"aggregate",
		"limit",
		"member"
	]);
	const resolution = args.resolution;
	const aggregate = args.aggregate;
	if (present(resolution) && !RESOLUTIONS.includes(resolution)) out.push({
		parameter: "resolution",
		reason: `must be one of ${RESOLUTIONS.join(", ")}`
	});
	if (present(aggregate) && !AGGREGATES.includes(aggregate)) out.push({
		parameter: "aggregate",
		reason: `must be one of ${AGGREGATES.join(", ")}`
	});
	const selectors = ["keywords", "indicators"].filter((key) => present(args[key]));
	if (selectors.length > 1) out.push({
		parameter: "keywords+indicators",
		reason: "give keywords or indicators — not both"
	});
	const res = String(resolution || "raw");
	const agg = String(aggregate || "none");
	if (RESOLUTIONS.includes(res) && AGGREGATES.includes(agg) && !DISPATCH.has(`${res}|${agg}`)) out.push({
		parameter: "aggregate",
		reason: `${agg} is not defined for resolution=${res}`
	});
	if (selectors.length === 0 && agg !== "none") out.push({
		parameter: "aggregate",
		reason: "the catalogue cannot be aggregated; pick indicators first"
	});
	if (selectors.length === 0 && res !== "raw") out.push({
		parameter: "resolution",
		reason: "the catalogue has no resolution; pick indicators first"
	});
	if ((res !== "raw" || agg !== "none") && present(args.limit)) out.push({
		parameter: "limit",
		reason: "only applies to raw rows without aggregation"
	});
	const limit = args.limit;
	if (present(limit) && (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 500)) out.push({
		parameter: "limit",
		reason: "must be an integer between 1 and 500"
	});
	out.push(...rejectDates(args));
	return out;
}
function validateMedicationQuery(args) {
	const out = rejectUnknown(args, [
		"view",
		"keywords",
		"start",
		"end",
		"member"
	]);
	const view = args.view;
	if (present(view) && !MED_VIEWS.includes(view)) out.push({
		parameter: "view",
		reason: `must be one of ${MED_VIEWS.join(", ")}`
	});
	out.push(...rejectDates(args));
	return out;
}
function validateGeneticQuery(args) {
	const out = rejectUnknown(args, [
		"rsids",
		"include_nearby",
		"nearby_range",
		"limit",
		"member"
	]);
	const rsids = args.rsids;
	if (!Array.isArray(rsids) || rsids.length === 0 || rsids.every((item) => typeof item !== "string" || !item.trim())) out.push({
		parameter: "rsids",
		reason: "name at least one rsID; this tool has no catalogue to browse"
	});
	else if (rsids.length > 50) out.push({
		parameter: "rsids",
		reason: "at most 50 rsIDs per call"
	});
	const limit = args.limit;
	if (present(limit) && (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 500)) out.push({
		parameter: "limit",
		reason: "must be an integer between 1 and 500"
	});
	const range = args.nearby_range;
	if (present(range) && (typeof range !== "number" || !Number.isInteger(range) || range < 1)) out.push({
		parameter: "nearby_range",
		reason: "must be a positive number of base pairs"
	});
	const nearby = args.include_nearby;
	if (present(nearby) && typeof nearby !== "boolean") out.push({
		parameter: "include_nearby",
		reason: "must be true or false"
	});
	return out;
}
function invalidArguments(problems) {
	return {
		success: false,
		error_kind: "invalid_arguments",
		error: formatRejections(problems),
		hint: "The arguments were not accepted. Check the tool parameter list and try once with corrected arguments."
	};
}
//#endregion
//#region src/tools.ts
function jsonText(value) {
	return [{
		type: "text",
		text: JSON.stringify(value, null, 2)
	}];
}
function dropEmpty(args) {
	const out = {};
	for (const [key, value] of Object.entries(args)) {
		if (value === void 0 || value === null || value === "") continue;
		if (Array.isArray(value) && value.length === 0) continue;
		out[key] = value;
	}
	return out;
}
async function engine(config, payload) {
	return runBridge(discoverPython(config.pythonBin), config.mirobodyHome, payload, config.timeoutMs);
}
async function record(config, name, args) {
	const called = await callMcpTool({
		url: config.mcpUrl,
		token: config.mcpToken,
		name,
		args: dropEmpty(args),
		timeoutMs: config.timeoutMs
	});
	if (called.success === false) return called;
	return called.result ?? called;
}
const jsonOut = {
	schema: { type: "json" },
	render: (_args, value) => jsonText(value)
};
function registerTools(ctx, config) {
	ctx.tools.register(defineTool({
		name: "resolve_indicator",
		description: "Resolve health indicator names to canonical LOINC codes. Offline, no user record, no network. Any language and clinical shorthand: \"LDL-C\", \"低密度脂蛋白胆固醇\" and \"ヘモグロビン\" resolve here. Use before storing a reading, comparing labs, or treating two names as the same test. Unresolved is an honest no: report it unmatched and never invent a code. Panel names such as \"blood pressure\" or \"血脂\" deliberately do not resolve; ask for the specific measurement. Pass the printed value and unit to resolve_reading when you have them, because a different unit is a different LOINC code. Same code from two names means the same test.",
		parameters: { names: {
			type: "array",
			items: { type: "string" },
			required: true,
			description: "Names exactly as printed. Pass the whole batch in one call, at most 200."
		} },
		output: jsonOut,
		timeoutMs: 6e4,
		isConcurrencySafe: () => true,
		async execute(args) {
			return asJson(await engine(config(), {
				op: "resolve",
				names: args.names
			}));
		}
	}));
	ctx.tools.register(defineTool({
		name: "resolve_reading",
		description: "Resolve one printed reading (name + value + unit) to the LOINC code that identity implies. Offline. A name alone is several codes: total cholesterol in mmol/L is 14647-2 and in mg/dL is 2093-3; a neutrophil percentage and a neutrophil count are different codes. Use this whenever the value and unit are known. Use resolve_indicator only for a bare name. Unresolved means the engine refused to guess. Do not invent a code, and do not scale the number yourself.",
		parameters: {
			name: {
				type: "string",
				required: true,
				description: "Indicator name exactly as printed, any language."
			},
			value: {
				type: "string",
				required: true,
				description: "The number as printed, including a percent sign when that is what the report shows, e.g. \"5.0\" or \"62 %\"."
			},
			unit: {
				type: "string",
				description: "Unit as printed, e.g. \"mmol/L\". Omit only when the report has none."
			}
		},
		output: jsonOut,
		timeoutMs: 6e4,
		isConcurrencySafe: () => true,
		async execute(args) {
			return asJson(await engine(config(), {
				op: "resolve_reading",
				name: args.name,
				value: args.value,
				unit: args.unit ?? ""
			}));
		}
	}));
	ctx.tools.register(defineTool({
		name: "convert_unit",
		description: "Convert one measurement between units. Offline, no user data. Use this before comparing or charting readings recorded in different units. Never scale a value by hand. converted null is an answer, not a failure: the units are not interconvertible (a percentage is not an absolute count, or the molar mass is not carried for that LOINC). Report those readings separately with their own units. Pass loinc_code to cross mass and substance concentration (mg/dL and mmol/L). Omit it for same-dimension conversions.",
		parameters: {
			value: {
				type: "number",
				required: true,
				description: "The number as recorded, e.g. 5.6."
			},
			from_unit: {
				type: "string",
				required: true,
				description: "Unit it is in now, as printed, e.g. \"mmol/L\"."
			},
			to_unit: {
				type: "string",
				required: true,
				description: "Unit wanted, e.g. \"mg/dL\"."
			},
			loinc_code: {
				type: "string",
				description: "The reading's LOINC code. Required only to cross mass and substance concentration."
			}
		},
		output: jsonOut,
		timeoutMs: 6e4,
		isConcurrencySafe: () => true,
		async execute(args) {
			return asJson(await engine(config(), {
				op: "convert",
				value: args.value,
				from_unit: args.from_unit,
				to_unit: args.to_unit,
				loinc_code: args.loinc_code ?? ""
			}));
		}
	}));
	ctx.tools.register(defineTool({
		name: "normalize_unit",
		description: "Normalize free-text measurement units to canonical UCUM. Offline, no user data. The same unit is written many ways (\"mg/dL\", \"MG/DL\", \"毫摩尔每升\"): normalize before comparing or converting. family classifies the LOINC property; it does NOT say what converts. kg/m2 and mg/dL can share a family and still be inconvertible, while U/L and [IU]/L can be the same unit in different families. Call convert_unit for that question. An empty ucum means unrecognized: say so rather than assuming.",
		parameters: { units: {
			type: "array",
			items: { type: "string" },
			required: true,
			description: "Unit strings as printed, at most 200, e.g. [\"mg/dL\", \"毫摩尔每升\", \"次/分\"]."
		} },
		output: jsonOut,
		timeoutMs: 6e4,
		isConcurrencySafe: () => true,
		async execute(args) {
			return asJson(await engine(config(), {
				op: "normalize",
				units: args.units
			}));
		}
	}));
	ctx.tools.register(defineTool({
		name: "query_health_indicators",
		description: "Read one person's coded health indicators from their Mirobody server. Read-only. Omit both keywords and indicators to get the catalogue. Use keywords when the exact name is unknown, then copy exact indicator names into a later call. resolution is raw or one value per minute/hour/day/week/month. aggregate none returns rows; stats returns count/min/max/avg/first/last/change (use it for \"how did it change\" and for a baseline); latest returns the most recent value per indicator. latest is not defined for minute or hour. limit applies only to raw rows without aggregation (1–500). Give keywords or indicators, not both. Dates are YYYY-MM-DD in the person's zone. Absence means not on file, not \"normal\". Every number you cite must come from this result. Requires mcpUrl.",
		parameters: {
			keywords: {
				type: "array",
				items: { type: "string" },
				description: "Free-text terms against the person's catalogue, any language. Omit both keywords and indicators for the catalogue."
			},
			indicators: {
				type: "array",
				items: { type: "string" },
				description: "Exact indicator names copied from a previous result. Preferred once known."
			},
			start: {
				type: "string",
				description: "First local date, inclusive (YYYY-MM-DD)."
			},
			end: {
				type: "string",
				description: "Last local date, inclusive (YYYY-MM-DD)."
			},
			resolution: {
				type: "string",
				enum: [
					"raw",
					"minute",
					"hour",
					"day",
					"week",
					"month"
				],
				description: "raw readings, or one value per minute/hour/day/week/month."
			},
			aggregate: {
				type: "string",
				enum: [
					"none",
					"stats",
					"latest"
				],
				description: "none: rows; stats: count/min/max/avg/first/last/change; latest: most recent value per indicator."
			},
			limit: {
				type: "integer",
				description: "Raw rows per indicator, 1–500. Only for resolution=raw and aggregate=none."
			},
			member: {
				type: "string",
				description: "Care-circle member id. Omit for the caller."
			}
		},
		output: jsonOut,
		timeoutMs: 6e4,
		isConcurrencySafe: () => true,
		async execute(args) {
			const problems = validateHealthQuery(args);
			if (problems.length > 0) return asJson(invalidArguments(problems));
			return asJson(await record(config(), "query_health_indicators", args));
		}
	}));
	ctx.tools.register(defineTool({
		name: "query_medications",
		description: "Read this person's medications from their Mirobody server. Read-only: it cannot add, change, or stop a medication. view=plan is the list they intend to take, with status and today's dose states — NOT an intake record. view=log is doses actually recorded taken or skipped (default window: last 30 days). view=history is courses with start, end, and why they ended, which is how a \"when did I switch\" question gets a date for query_health_indicators. A plan is not evidence a dose was swallowed. A dose missing from the log is not evidence it was not taken. Do not use this for drug information, interactions, or dose advice. Requires mcpUrl.",
		parameters: {
			view: {
				type: "string",
				enum: [
					"plan",
					"log",
					"history"
				],
				description: "plan (default), log, or history."
			},
			keywords: {
				type: "array",
				items: { type: "string" },
				description: "Drug names or codes to narrow to. Omit for every medication."
			},
			start: {
				type: "string",
				description: "First local date, inclusive (YYYY-MM-DD)."
			},
			end: {
				type: "string",
				description: "Last local date, inclusive (YYYY-MM-DD)."
			},
			member: {
				type: "string",
				description: "Care-circle member id. Omit for the caller."
			}
		},
		output: jsonOut,
		timeoutMs: 6e4,
		isConcurrencySafe: () => true,
		async execute(args) {
			const problems = validateMedicationQuery(args);
			if (problems.length > 0) return asJson(invalidArguments(problems));
			return asJson(await record(config(), "query_medications", args));
		}
	}));
	ctx.tools.register(defineTool({
		name: "query_genetic_data",
		description: "Read this person's genotype calls at named rsIDs from the genotype file they uploaded to Mirobody. Read-only. There is no catalogue: name the rsIDs (at most 50). An rsID missing from the result was not typed, which is not evidence about the allele. Genotypes are unphased: \"AG\" does not say which parent contributed which allele. include_nearby returns variants near by POSITION only; proximity is not linkage and says nothing about the queried variant's trait. Report the genotype. Do not interpret risk, do not diagnose, and do not turn a call into a treatment. Requires mcpUrl.",
		parameters: {
			rsids: {
				type: "array",
				items: { type: "string" },
				required: true,
				description: "dbSNP identifiers, e.g. [\"rs4988235\", \"rs1801133\"]. At most 50."
			},
			include_nearby: {
				type: "boolean",
				description: "Also return typed variants within nearby_range of each hit. Default true on the server when omitted."
			},
			nearby_range: {
				type: "integer",
				description: "Half-window for include_nearby, in base pairs. Server default 1000000."
			},
			limit: {
				type: "integer",
				description: "Direct hits returned, 1–500. Name fewer rsIDs instead of raising it."
			},
			member: {
				type: "string",
				description: "Care-circle member id. Omit for the caller."
			}
		},
		output: jsonOut,
		timeoutMs: 6e4,
		isConcurrencySafe: () => true,
		async execute(args) {
			const problems = validateGeneticQuery(args);
			if (problems.length > 0) return asJson(invalidArguments(problems));
			return asJson(await record(config(), "query_genetic_data", args));
		}
	}));
	ctx.tools.register(defineTool({
		name: "mirobody_status",
		description: "Report whether the offline Mirobody engine imports and whether a record server URL is configured. Use this when a terminology or record tool failed, or before telling the user that labs are unavailable. Does not return health records. The token and any credential embedded in the MCP URL are not included.",
		parameters: {},
		output: jsonOut,
		timeoutMs: 6e4,
		isConcurrencySafe: () => true,
		async execute() {
			const current = config();
			return asJson({
				engine: await engine(current, { op: "status" }),
				mcp: {
					configured: Boolean(current.mcpUrl.trim()),
					host: mcpHost(current.mcpUrl),
					token_set: Boolean(current.mcpToken.trim())
				},
				python_bin: discoverPython(current.pythonBin)
			});
		}
	}));
}
//#endregion
//#region src/index.ts
const name = "dsh-plugin-mirobody";
const inject = ["tools"];
function apply(ctx, config) {
	const configSource = () => config;
	registerTools(ctx, configSource);
	registerSkills(ctx);
	registerPrompt(ctx);
	registerRoutes(ctx, configSource);
	registerCommands(ctx, configSource);
	ctx.on("agent/pre-step", (payload, next) => guardPreStep(payload, next));
}
//#endregion
export { CONNECTION_UNAVAILABLE, Config, EMERGENCY_REPLY_ZH, LABEL_KEYS, NO_MEDICATION_CHANGE_ZH, PRODUCT_VERSION, TOOL_NAMES, apply, bridgeEnv, discoverPython, guardPreStep, guardRoute, guidanceNote, inject, isJsonRequest, mentionsMedicine, name, noteMessage, personText, preGuard, ruleLabels, runBridgeSync, validateGeneticQuery, validateHealthQuery, validateMedicationQuery, wrapGuardMessage };
