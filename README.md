# dsh-plugin-mirobody

**English** · **[中文](README.zh.md)**

DeepSeek Harness plugin for [Mirobody](https://github.com/thetahealth/mirobody): one LOINC code for a lab name, one UCUM unit, and the same read-only record tools Mirobody serves at `/mcp`.

The Python engine stays the resolver. This package is the harness: eight tools, four skills, a Mirobody tab, and slash commands. It does not reimplement the LOINC bundle, Postgres, wearable OAuth, or file ingestion.

## Install

Requires Node 22.19+, pnpm (`dsh plugin` installs through it), and a Python 3.12+ interpreter with `mirobody` installed.

**With [dsh-plugin-longpi](https://github.com/zwbao/dsh-plugin-longpi) you do not install this separately.** LongPi declares this plugin as a dependency, so `dsh plugin add` puts it in the profile and LongPi mounts it with the settings in LongPi's own row. Adding it a second time registers the same tools twice.

On its own:

```bash
# 1. The Python engine (offline terminology)
python3.12 -m venv ~/.venvs/mirobody && ~/.venvs/mirobody/bin/pip install mirobody

# 2. Into the DSH web profile (created on first use)
dsh plugin --profile web add github:zwbao/dsh-plugin-mirobody
```

Then override the row in `~/.dsh/profiles/web/cordis.patch.yml` (replace the file's `[]` with the block below). A patch replaces the row's whole `config`, so restate every key:

```yaml
- id: dsh-plugin-mirobody
  config:
    pythonBin: /Users/you/.venvs/mirobody/bin/python   # your absolute path
    mirobodyHome: ''
    mcpUrl: http://127.0.0.1:18060/mcp/<personal-secret>  # Mirobody Settings → MCP
    mcpToken: ''
    timeoutMs: 30000
```

`dsh --profile web --dump-config` shows the row in effect; then restart `dsh web`. From a checkout: `git clone https://github.com/zwbao/dsh-plugin-mirobody && cd dsh-plugin-mirobody && npm install && npm test && dsh plugin --profile web add link:$PWD`.

| Field | Meaning |
| --- | --- |
| `pythonBin` | Interpreter that can `import mirobody`. Empty tries `python3.14`, `python3.13`, `python3.12`, then `python3`. |
| `mirobodyHome` | Optional source checkout added to `sys.path`. A checkout still needs `git lfs pull` for the LOINC bundle. |
| `mcpUrl` | Record server: the personal URL from Mirobody Settings → MCP (`…/mcp/<secret>`, valid 30 days by default, Mirobody's `MCP_URL_TTL_DAYS`), or `http://127.0.0.1:18060/mcp` with `mcpToken`. |
| `mcpToken` | Account JWT when the URL does not carry one (the `access_token` from `POST /password/login`, valid 30 days by default). Leave empty for terminology-only use. |
| `timeoutMs` | Bridge and MCP budget. Default `30000`. First resolve loads the bundle and can be slower. |

The Python bridge starts with a minimal environment, never the harness's own: `PATH`, `HOME`, `LANG`, `LC_ALL`, `TMPDIR`, `MIROBODY_HOME` (from `mirobodyHome`), `PYTHONNOUSERSITE=1` and `PYTHONDONTWRITEBYTECODE=1`. So `pythonBin` must import `mirobody` from its own site-packages (the venv above); a `pip install --user` copy and `PYTHONPATH` are not seen. Use `mirobodyHome` for a source checkout.

## Tools

| Tool | Where it runs | What it returns |
| --- | --- | --- |
| `resolve_indicator` | local engine | LOINC for each printed name. Unresolved is empty, not a guess. |
| `resolve_reading` | local engine | LOINC for a name plus value and unit. The unit selects the code. |
| `convert_unit` | local engine | A converted number, or `null` when the units are not interconvertible. |
| `normalize_unit` | local engine | UCUM form and property family. |
| `query_health_indicators` | Mirobody `/mcp` | Catalogue, rows, buckets, stats, or latest. |
| `query_medications` | Mirobody `/mcp` | Plan, dose log, or course history. Read-only. |
| `query_genetic_data` | Mirobody `/mcp` | Genotype calls at named rsIDs. A missing rsID was not typed. |
| `mirobody_status` | local | Whether the engine imports, and whether `mcpUrl` is set. No chart data, no token. |

## Commands and HTTP

- `/mirobody` — engine version and whether MCP is configured
- `/mirobody-resolve 血红蛋白 血脂` — offline resolve
- `/mirobody-version`
- `GET /api/mirobody/status`
- `GET /api/mirobody/resolve?q=血红蛋白&q=血脂`
- `GET /api/mirobody/version`

Each route runs DeepSeek Harness's own connection check first (Host/Origin and the session cookie): 401 or 403 otherwise, 503 when the connection service is missing. A write must be `application/json` (415 otherwise).

The web tab is **Mirobody**. It forwards the DSH `token` query parameter the same way the page was opened and sends the session cookie.

## Boundaries

Not a medical device. No diagnosis, no dose change. When a message describes an emergency happening now, or real self-harm wording, the plugin appends a note after it so the reply begins with “call 120” (988 in the US) and gives no treatment steps; a request to start, stop or change a medicine gets a note to leave it to the prescribing doctor. The person's words are never replaced. A negated symptom, a family member's history, a risk question or a past event does not trigger it. See [docs/intended-use.md](docs/intended-use.md).

`血红蛋白` resolves to `718-7`. `血脂` resolves to nothing, because it names a panel. Total cholesterol `5.0 mmol/L` resolves to `14647-2`.

Apache-2.0. Mirobody and its terminology licences are named in [NOTICE](NOTICE).
