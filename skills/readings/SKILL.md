---
name: mirobody-readings
description: Read one person's coded indicators from their Mirobody server with query_health_indicators. Cite only returned numbers.
---

# Readings

`query_health_indicators` is the only read for labs, vitals, and device series. It needs `mcpUrl` pointing at that person's Mirobody server. If the call returns `error_kind: unavailable` or `denied`, say the record is not connected. Do not fill in example values.

## One call

Give `keywords` or `indicators`, never both.

- Unknown name: `keywords`, any language. Then copy the exact names the catalogue returned into `indicators`.
- Omit both to list the catalogue.
- "How did it change" or a baseline: `aggregate=stats` (count, min, max, avg, first, last, change). Do not add the rows up yourself.
- Most recent value: `aggregate=latest`. Not valid for `resolution=minute` or `hour`.
- A curve: `resolution` of `minute`, `hour`, `day`, `week`, or `month` with `aggregate=none`.
- `limit` only applies to `resolution=raw` and `aggregate=none`, from 1 to 500. Narrow the window instead of raising it.
- Dates are `YYYY-MM-DD`, inclusive, in the person's zone. Omit both for the whole record.
- `member` is a care-circle id. Omit it for the caller. A refused member is denied; do not try another route.

## How to answer

Every number you quote comes from the tool result, with its unit and the file or source the result names. Empty means not on file, which is not the same as normal or zero. Do not diagnose from a trend.
