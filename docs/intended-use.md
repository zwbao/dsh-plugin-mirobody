# Intended use

dsh-plugin-mirobody is a staff and personal DeepSeek Harness surface over [thetahealth/mirobody](https://github.com/thetahealth/mirobody). It is not a medical device, not a diagnostic, and not a prescribing system.

## What it does

- Resolves indicator names to LOINC and units to UCUM by calling the installed Mirobody Python engine. That step is offline and does not send the name to a model.
- Reads indicators, medications, and genotype calls from a Mirobody server the operator configures (`mcpUrl`). The plugin does not open Postgres, does not store a second copy of the chart, and does not perform wearable OAuth or file ingestion. Those stay in Mirobody.
- Refuses emergency triage beyond "call 120" (988 in the US) and refuses dose changes. It does so by appending one note for the model after the person's message; the message itself is never rewritten.

## What it does not do

- Invent a LOINC code when the engine returns unresolved.
- Start, stop, or adjust a medicine.
- Interpret a genotype as a diagnosis.
- Attach this plugin to a customer product that must not see PHI. Record tools return whatever the configured Mirobody account is allowed to read.

## Secrets

`mcpToken` and any credential inside `mcpUrl` live in the local DSH profile config. The status route and `mirobody_status` report only the host and whether a token is set.

The Python bridge does not inherit the harness's environment (API keys, tokens): it gets `PATH`, `HOME`, `LANG`, `LC_ALL`, `TMPDIR`, `MIROBODY_HOME`, `PYTHONNOUSERSITE=1` and `PYTHONDONTWRITEBYTECODE=1`, nothing else. This is not a sandbox.
