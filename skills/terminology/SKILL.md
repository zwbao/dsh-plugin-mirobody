---
name: mirobody-terminology
description: Resolve a lab name to LOINC and a unit to UCUM with the offline Mirobody engine before comparing readings. Unresolved is an honest no.
---

# Terminology

Use `resolve_indicator`, `resolve_reading`, `convert_unit`, and `normalize_unit`. They do not read a person's chart and do not need `mcpUrl`.

## Which tool

- A bare name, any language: `resolve_indicator` with the whole batch in one call.
- A name plus the printed value and unit: `resolve_reading`. The unit is part of the code. Total cholesterol in mmol/L is 14647-2; in mg/dL it is 2093-3. A neutrophil percent and a neutrophil count are two codes.
- Before comparing numbers that were written in different units: `normalize_unit`, then `convert_unit`. Never multiply by a factor you remember.
- `convert_unit` returns `converted: null` when the units are not interconvertible. Say so and keep both original units. Pass `loinc_code` only when crossing mass and substance concentration.

## What a result means

- `resolved: false` or an empty `loinc` means the engine refused. Report the name as unmatched. Do not invent a code and do not pick a nearby candidate silently. If `candidates` is large, say the match was ambiguous.
- Panel words do not resolve: 血脂, blood pressure, 血圧. Ask for the specific measurement (LDL-C, systolic, diastolic).
- The same LOINC from two spellings means the same test. String equality does not.
- `family` on a unit classifies the property. It does not say which units convert. Call `convert_unit` for that.

## Boundary

These tools standardize a name. They do not say whether a number is healthy, and they do not diagnose.
