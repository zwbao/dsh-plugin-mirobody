---
name: mirobody-pharmacogenomics
description: Check whether a CPIC guideline exists for a drug–gene pair and which defining sites the person's upload covers. Never a phenotype or a dose.
---

# Pharmacogenomics

`query_pharmacogenomics` compares CPIC level A/B drug–gene pairs with the genotype file this person uploaded to Mirobody. Pass `drugs` (exact CPIC generic names) and/or `genes` (HGNC symbols), at most 10 each. With neither, it checks the person's active medication plans (plans, not doses confirmed taken).

## What a row says

- `cpic_level` says a guideline exists for that gene–drug pair. It is not this person's phenotype, diplotype, or metaboliser status.
- `called_sites`, `missing_rsids`, `no_call_rsids` and `unresolved_rsids` say what the upload covers. A missing or no-call site never means a normal diplotype. An array cannot establish phase or copy number.
- A name the result lists as having no CPIC A/B pair is outside this table. That does not prove there is no interaction.
- The rows carry no rid. To cite a genotype, read it with `query_genetic_data`.

## Boundary

Do not infer a phenotype, recommend a test, or advise starting, stopping, or changing a medicine or a dose. Point the person to the prescriber or a pharmacist with the guideline link the row gives.
