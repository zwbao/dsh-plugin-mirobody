---
name: mirobody-genetics
description: Look up genotype calls at named rsIDs in the person's uploaded file. A missing rsID was not typed.
---

# Genetics

`query_genetic_data` reads the genotype file this person uploaded to Mirobody. It is not a reference database and it has no catalogue. Pass `rsids` (at most 50), for example `["rs4988235", "rs1801133"]`.

## Say these limits in the answer

- An rsID missing from the result was not typed. That is not a negative result and not evidence about the allele.
- Genotypes are unphased. `AG` does not say which parent contributed which allele.
- `include_nearby` returns variants near by position. Proximity is not linkage. Do not tie a neighbour to the queried variant's trait.
- Report the call (rsID, chromosome, position, genotype). Do not interpret risk, do not diagnose, and do not recommend a test or a drug.

`nearby_range` is a half-window in base pairs. `limit` caps direct hits. Name fewer rsIDs instead of raising it. `member` is a care-circle id.
