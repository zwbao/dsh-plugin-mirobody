# Changelog

Versions stay below 1.0 until the owner declares the plugin stable. 0.1.0 and 0.1.1 were first published as 1.0.0 and 1.0.1.

## 0.1.2

Follows Mirobody 1.5.2 and later (tested against 1.5.9), whose record tools changed parameters ([#3](https://github.com/zwbao/dsh-plugin-mirobody/issues/3)). Against a 1.5.2+ server, every record call except a bare keywords/indicators/start/end query failed: the plugin refused the new parameters and the server refused the old ones.

- `query_health_indicators`: one `view` (`raw`, `minute`, `hour`, `day`, `week`, `month`, `stats`, `latest`, `trend`) replaces `resolution` × `aggregate`; `limit` and `member` are gone. The server caps rows itself and says when it cut them.
- `query_medications`: `member` is gone. Whose record is read is decided by the token or personal link, one person per call.
- `query_genetic_data`: select by `rsids`, `gene`, or a region (`chromosome`, `start`, `end`, `build`); with none, a summary of the upload. `include_nearby`, `nearby_range`, `limit` and `member` are gone.
- New tool `query_pharmacogenomics` (CPIC A/B drug–gene pairs and the upload's coverage of their defining sites) and skill `mirobody-pharmacogenomics`. Nine tools.
- Validation is the server's. The plugin no longer refuses a parameter it does not know; Mirobody refuses it with a reason per parameter, so a later server change does not break the plugin. Local checks keep only what the server also says: keywords or indicators, not both; calendar dates; rsID form and the 50-rsID cap.
- MCP: a tool answer with `isError: true` (how Mirobody sends a refused, denied or failed read) is now an error with its `error_kind`, not data.
- Tests: the declared parameters of the four record tools are compared with the `TOOL_SCHEMA` of the installed Mirobody package when one is present.
- README: the personal MCP link is valid 10 days by default since Mirobody 1.5.3, not 30.
- Terminology tools are unchanged; the engine functions they call kept their signatures (checked against 1.5.9).

## 0.1.1

- Guard: clause-aware rules (ported from LongPi's fallback). A negated symptom (无胸痛, 否认胸痛, no chest pain), a family member's history (父亲有中风史, 父母有早发心梗), a risk question (heart attack risk, stroke risk), heat stroke and 我不想活到120岁 or 我不想死 no longer count as emergencies; real self-harm wording (我不想活了, 想自杀, suicide) still does. A medicine-change note needs a named medicine and a request, not a record. NFKC-normalised.
- Guard: the person's message is never replaced or dropped. The pre-step listener calls `next()` first and appends one plugin notice (`form: 'notice'`) after the claimed messages: the 120 wording for an emergency, the no-change wording for a medicine. Only the person's own messages are read, not tool results.
- Routes: `/api/mirobody/status`, `/resolve` and `/version` run DeepSeek Harness's connection check first (`requestRejection`: 401 or 403), answer 503 when the connection service is missing, and refuse a write that is not `application/json` (415).
- Bridge: the Python process gets a minimal environment (`PATH`, `HOME`, `LANG`, `LC_ALL`, `TMPDIR`, `MIROBODY_HOME`, `PYTHONNOUSERSITE=1`, `PYTHONDONTWRITEBYTECODE=1`), not the harness's. Install `mirobody` in the interpreter's own site-packages (a venv).

## 0.1.0

- DSH bundle for Mirobody's published agent surface.
- Offline tools call `mirobody.engine` and `mirobody.units` through `bridge/dsh_bridge.py`: `resolve_indicator`, `resolve_reading`, `convert_unit`, `normalize_unit`.
- Record tools proxy `query_health_indicators`, `query_medications`, and `query_genetic_data` to a configured Mirobody `/mcp` endpoint.
- Skills, system prompt, Mirobody tab, and `/mirobody` commands.
- Argument checks follow Mirobody's query grammar: keywords or indicators, resolution/aggregate dispatch, medication views, rsID caps.
- Emergency and dose-change guardrails. No chart is stored in the plugin.
