import Schema from "@deepseek-ai/schemastery";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
function bridgeEnv(home) {
	return {
		...process.env,
		MIROBODY_HOME: home.trim(),
		PYTHONDONTWRITEBYTECODE: "1"
	};
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
					name: "dsh-plugin-mirobody",
					version: "1.0.0"
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
//#region src/version.ts
const PRODUCT_VERSION = "1.0.0";
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
const EMERGENCY = [
	"胸痛",
	"胸口疼",
	"呼吸困难",
	"喘不上气",
	"晕倒",
	"昏迷",
	"抽搐",
	"大出血",
	"自杀",
	"不想活",
	"严重过敏",
	"中风",
	"半身麻木",
	"chest pain",
	"can't breathe",
	"fainted",
	"seizure",
	"suicide",
	"overdose",
	"stroke"
];
const DOSE_CHANGE = /(停药|把药停|停掉.{0,4}药|加量|减量|换药|改剂量|调整剂量|increase (the |my )?dose|stop (my |the )?(medication|medicine|drug)|change (my |the )?dose)/i;
function preGuard(text) {
	const lower = text.toLowerCase();
	if (EMERGENCY.some((k) => lower.includes(k.toLowerCase()))) return {
		code: "emergency",
		reply_zh: "如果您正在经历紧急不适，请立即拨打 120 或当地急救电话。在美国可拨打或发短信至 988。我不能替代急救，也不会给出处理步骤。"
	};
	if (DOSE_CHANGE.test(text)) return {
		code: "no_medication_change",
		reply_zh: "我不能建议开始、停止、加量、减量或更换药物。用药记录只读。调整处方请联系开具该药的医生。"
	};
	return null;
}
function extractUserText(content) {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content.map((block) => {
		if (block && typeof block === "object" && "type" in block && block.type === "text") return String(block.text ?? "");
		return "";
	}).join("\n");
}
function wrapGuardMessage(text, hit) {
	return [
		hit.reply_zh,
		"",
		"Answer with that boundary only. Do not add a diagnosis, a dose, or a treatment step.",
		`The user said: ${text.slice(0, 500)}`
	].join("\n");
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
	const text = JSON.stringify(body);
	res.statusCode = status;
	res.setHeader("Content-Type", "application/json; charset=utf-8");
	res.setHeader("Cache-Control", "no-store");
	res.end(text);
}
function queryNames(url) {
	if (!url) return [];
	return new URL(url, "http://127.0.0.1").searchParams.getAll("q").map((item) => item.trim()).filter(Boolean).slice(0, 20);
}
function registerRoutes(ctx, config) {
	ctx.inject(["webServer"], (scoped) => {
		scoped.webServer.register({
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
		scoped.webServer.register({
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
		scoped.webServer.register({
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
	ctx.on("agent/pre-step", async (payload, next) => {
		const text = payload.messages.map((message) => extractUserText(message.content)).join("\n");
		const hit = preGuard(text);
		if (!hit) return next();
		const first = payload.messages[0];
		if (!first) return { kind: "reject" };
		return {
			kind: "enter",
			messages: [{
				...first,
				content: [{
					type: "text",
					text: wrapGuardMessage(text, hit)
				}]
			}]
		};
	});
}
//#endregion
export { Config, PRODUCT_VERSION, TOOL_NAMES, apply, discoverPython, inject, name, preGuard, runBridgeSync, validateGeneticQuery, validateHealthQuery, validateMedicationQuery, wrapGuardMessage };
