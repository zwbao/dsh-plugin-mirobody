window.__ModuleLoader__.load({
	id: "dsh-plugin-mirobody",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region \0rolldown/runtime.js
		var __create = Object.create;
		var __defProp = Object.defineProperty;
		var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
		var __getOwnPropNames = Object.getOwnPropertyNames;
		var __getProtoOf = Object.getPrototypeOf;
		var __hasOwnProp = Object.prototype.hasOwnProperty;
		var __copyProps = (to, from, except, desc) => {
			if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
				key = keys[i];
				if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
					get: ((k) => from[k]).bind(null, key),
					enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
				});
			}
			return to;
		};
		var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule || !__hasOwnProp.call(mod, "default") ? __defProp(target, "default", {
			value: mod,
			enumerable: true
		}) : target, mod));
		//#endregion
		let react = require("react");
		react = __toESM(react, 1);
		//#region src/client/constants.ts
		const VIEW_ID = "mirobody-dashboard";
		const SUGGESTED = [
			{
				id: "loinc",
				zh: "血红蛋白、LDL cholesterol、空腹血糖分别是哪个 LOINC？"
			},
			{
				id: "unit",
				zh: "总胆固醇 5.0 mmol/L 对应哪个码？换成 mg/dL 是多少？"
			},
			{
				id: "panel",
				zh: "为什么“血脂”不能解析成一个化验项目？"
			},
			{
				id: "record",
				zh: "如果已经接上我的 Mirobody，查最近血压的变化，每个数字都要带来源。"
			}
		];
		//#endregion
		//#region src/client/panel.ts
		function api(path) {
			const token = new URLSearchParams(window.location.search).get("token");
			if (!token) return path;
			return `${path}${path.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`;
		}
		function registerPanel(ctx) {
			ctx.slots.inject("conversation.view", () => ctx.slots.register({
				name: "conversation.view",
				id: VIEW_ID,
				order: 22,
				label: () => "Mirobody"
			}, PanelView));
		}
		function PanelView() {
			const [status, setStatus] = react.default.useState(null);
			const [error, setError] = react.default.useState(null);
			const [query, setQuery] = react.default.useState("血红蛋白 血脂");
			const [rows, setRows] = react.default.useState(null);
			const [busy, setBusy] = react.default.useState(false);
			react.default.useEffect(() => {
				let cancelled = false;
				fetch(api("/api/mirobody/status"), { credentials: "include" }).then(async (res) => {
					if (!res.ok) throw new Error(`HTTP ${res.status}`);
					return res.json();
				}).then((json) => {
					if (!cancelled) setStatus(json);
				}).catch((err) => {
					if (!cancelled) setError(err instanceof Error ? err.message : "status failed");
				});
				return () => {
					cancelled = true;
				};
			}, []);
			async function resolveNames() {
				const names = query.split(/\s+/).map((item) => item.trim()).filter(Boolean).slice(0, 20);
				if (names.length === 0) return;
				setBusy(true);
				setRows(null);
				try {
					const params = names.map((name) => `q=${encodeURIComponent(name)}`).join("&");
					const res = await fetch(api(`/api/mirobody/resolve?${params}`), { credentials: "include" });
					const json = await res.json();
					if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
					setRows(Array.isArray(json.results) ? json.results : []);
				} catch (err) {
					setError(err instanceof Error ? err.message : "resolve failed");
				} finally {
					setBusy(false);
				}
			}
			const engine = status?.engine;
			const engineLine = engine?.ok ? `${engine.version || "mirobody"} · ${engine.python || ""}` : engine?.error || error || "引擎未就绪";
			return react.default.createElement("div", { className: "mb-dash" }, react.default.createElement("div", { className: "mb-kicker" }, `Mirobody ${status?.version ?? ""}`), react.default.createElement("h2", { className: "mb-title" }, "一郎记录，一个标准"), react.default.createElement("p", { className: "mb-lead" }, "指标名在本机解析成 LOINC，单位收成 UCUM。病历、用药和基因型只从你自己的 Mirobody 服务器读取，插件不另存一份。"), react.default.createElement("div", { className: "mb-grid" }, react.default.createElement("section", { className: "mb-card" }, react.default.createElement("h3", null, "离线引擎"), react.default.createElement("p", { className: engine?.ok ? "mb-ok" : "mb-bad" }, engineLine), engine?.bundle ? react.default.createElement("p", null, engine.bundle) : null), react.default.createElement("section", { className: "mb-card" }, react.default.createElement("h3", null, "记录服务器"), react.default.createElement("p", null, status?.mcp?.configured ? `${status.mcp.host || "已配置"} · token ${status.mcp.token_set ? "已设置" : "未设置"}` : "未配置 mcpUrl。术语工具不需要它。")), react.default.createElement("section", { className: "mb-card" }, react.default.createElement("h3", null, "工具"), react.default.createElement("p", null, `${status?.tools?.length ?? 8} 个：术语 4，记录 3，状态 1`))), react.default.createElement("form", {
				className: "mb-form",
				onSubmit: (event) => {
					event.preventDefault();
					resolveNames();
				}
			}, react.default.createElement("input", {
				value: query,
				"aria-label": "指标名",
				onChange: (event) => setQuery(event.target.value)
			}), react.default.createElement("button", {
				type: "submit",
				disabled: busy
			}, busy ? "解析中" : "解析")), ...(rows ?? []).map((row) => react.default.createElement("div", {
				className: "mb-row",
				key: row.name
			}, react.default.createElement("span", null, row.name), react.default.createElement("span", { className: "mb-code" }, row.resolved ? `${row.loinc || ""} ${row.canonical || ""}`.trim() : "未解析"))), react.default.createElement("p", { className: "mb-note" }, "未解析是诚实的空，不是漏码。这不是诊断，也不能改处方。紧急情况请拨打 120。"));
		}
		function registerDock(ctx) {
			ctx.slots.inject("conversation.input.dock", () => ctx.slots.register({
				name: "conversation.input.dock",
				id: "dsh-plugin-mirobody",
				order: 25
			}, SuggestDock));
		}
		function SuggestDock() {
			const [copied, setCopied] = react.default.useState(null);
			return react.default.createElement("div", { className: "mb-dock" }, react.default.createElement("span", { className: "mb-dock-kicker" }, "Mirobody"), ...SUGGESTED.map((item) => react.default.createElement("button", {
				key: item.id,
				type: "button",
				className: copied === item.id ? "mb-dock-chip mb-dock-chip-on" : "mb-dock-chip",
				onClick: () => {
					navigator.clipboard.writeText(item.zh).then(() => setCopied(item.id)).catch(() => setCopied(item.id));
				}
			}, item.zh)));
		}
		function registerSidebar(ctx) {
			ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
				name: "sidebar.footer.action",
				id: "dsh-plugin-mirobody",
				order: 40
			}, SidebarMark));
		}
		function SidebarMark(props) {
			return react.default.createElement("span", {
				className: "mb-sidebar",
				title: "Mirobody"
			}, react.default.createElement("span", { className: "mb-dot" }), props.wide === false ? null : react.default.createElement("span", null, "Mirobody"));
		}
		//#endregion
		//#region src/client/styles.ts
		const CSS = `
.mb-dash {
  height: 100%;
  overflow: auto;
  padding: 24px 28px 48px;
  background: #f3f6f6;
  color: #142224;
  font-family: "Iowan Old Style", Palatino, "Songti SC", serif;
}
.mb-kicker {
  font-size: 12px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #3d6b66;
  margin-bottom: 8px;
}
.mb-title {
  font-size: 32px;
  line-height: 1.1;
  margin: 0 0 8px;
}
.mb-lead {
  max-width: 42rem;
  color: #3c4a48;
  margin: 0 0 20px;
}
.mb-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
  margin-bottom: 20px;
}
.mb-card {
  background: #fff;
  border: 1px solid #d5e0de;
  border-radius: 12px;
  padding: 14px 16px;
}
.mb-card h3 {
  margin: 0 0 6px;
  font-size: 14px;
  font-weight: 600;
}
.mb-card p {
  margin: 0;
  font-size: 14px;
  line-height: 1.45;
}
.mb-ok { color: #1d6b45; }
.mb-bad { color: #8d3b32; }
.mb-form {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
.mb-form input {
  flex: 1;
  border: 1px solid #c5d4d1;
  border-radius: 8px;
  padding: 8px 10px;
  font: inherit;
  background: #fff;
}
.mb-form button, .mb-dock-chip {
  border: 1px solid #1f4f4a;
  background: #1f4f4a;
  color: #f4fbfa;
  border-radius: 999px;
  padding: 8px 14px;
  font: inherit;
  cursor: pointer;
}
.mb-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0;
  border-bottom: 1px solid #e4eeec;
  font-size: 15px;
}
.mb-code { font-variant-numeric: tabular-nums; }
.mb-note {
  margin-top: 16px;
  font-size: 13px;
  color: #5c6b69;
}
.mb-dock {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  padding: 4px 0;
}
.mb-dock-kicker {
  font-size: 12px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #3d6b66;
}
.mb-dock-chip {
  background: transparent;
  color: #1f4f4a;
}
.mb-dock-chip-on { background: #1f4f4a; color: #f4fbfa; }
.mb-sidebar {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}
.mb-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #1f4f4a;
}
`;
		function injectStyles() {
			if (typeof document === "undefined") return;
			if (document.getElementById("dsh-plugin-mirobody-style")) return;
			const style = document.createElement("style");
			style.id = "dsh-plugin-mirobody-style";
			style.textContent = CSS;
			document.head.appendChild(style);
		}
		//#endregion
		//#region src/client/index.ts
		const inject = ["slots"];
		function apply(ctx) {
			injectStyles();
			registerPanel(ctx);
			registerSidebar(ctx);
			registerDock(ctx);
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map