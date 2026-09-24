# Changelog

## 1.0.0

- DSH bundle for Mirobody's published agent surface.
- Offline tools call `mirobody.engine` and `mirobody.units` through `bridge/dsh_bridge.py`: `resolve_indicator`, `resolve_reading`, `convert_unit`, `normalize_unit`.
- Record tools proxy `query_health_indicators`, `query_medications`, and `query_genetic_data` to a configured Mirobody `/mcp` endpoint.
- Skills, system prompt, Mirobody tab, and `/mirobody` commands.
- Argument checks follow Mirobody's query grammar: keywords or indicators, resolution/aggregate dispatch, medication views, rsID caps.
- Emergency and dose-change guardrails. No chart is stored in the plugin.
