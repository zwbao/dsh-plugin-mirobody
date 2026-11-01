---
name: mirobody-readings
description: Read one person's coded indicators and reported entries from their Mirobody server with query_health_indicators. Cite only returned numbers.
---

# Readings

`query_health_indicators` is the only read for labs, vitals, device series, and what the person reported (symptoms, diagnoses they were given, notes). It needs `mcpUrl` pointing at that person's Mirobody server. If the call returns `error_kind: unavailable` or `denied`, say the record is not connected. Do not fill in example values.

## One call

Give `keywords` or `indicators`, never both. Pick one `view`.

- Unknown name: `keywords`, any language. Then copy the exact names the catalogue returned into `indicators`.
- Omit both to list the catalogue of what this person has.
- `view=raw` (default): the readings, newest first, each with the file it came from.
- `view=stats`: count, min, max, avg, sum, first, last, change. Use it for "how did it change", "how often", totals and a baseline. Do not add the rows up yourself.
- `view=trend`: direction and shape of the daily series. The 2% direction threshold is descriptive, not clinical.
- `view=latest`: the most recent value per indicator.
- `view=minute`, `hour`, `day`, `week` or `month`: one point per period, for a chart. Day and coarser count each day once; `stats` counts every reading, so the two can differ.
- Dates are `YYYY-MM-DD`, inclusive, in the person's zone. Omit both for the whole record.
- The server caps rows and marks the answer `truncated`. Narrow the window or ask for `stats` instead of calling again.

There is no parameter for another person. The server reads only the account its token or personal link belongs to.

## How to answer

Every number you quote comes from the tool result, with its unit and the file or source the result names. Empty means not on file, which is not the same as normal or zero. A reported condition is what the person says they were diagnosed with, not a clinical record. Do not diagnose from a trend.

If the server answers `invalid_arguments`, its reason names the parameter. Fix that one and try once.
