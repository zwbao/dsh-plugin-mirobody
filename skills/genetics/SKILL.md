---
name: mirobody-genetics
description: Look up genotype calls by rsID, gene, or region in the person's uploaded file. A missing locus was not typed.
---

# Genetics

`query_genetic_data` reads the genotype file this person uploaded to Mirobody. It is not a reference database. Choose one selector per call:

- `rsids` (at most 50), for example `["rs4988235", "rs1801133"]`.
- `gene`, an HGNC symbol such as `CYP2C19`.
- A region: `chromosome` (1–22, X, Y, PAR, MT), `start` and `end` as integer coordinates, and `build` (`GRCh37`, `GRCh38`, or `raw` for the upload's own positions; PAR takes only `raw`).

With no selector the tool returns a summary of the upload (vendor, build, rows called). The server cuts a long answer and says so; narrow the region.

## Say these limits in the answer

- A locus missing from the result, a no-call, or an unresolved call was not typed or not called. That is not a negative result and not evidence about the allele.
- Genotypes are unphased. `AG` does not say which parent contributed which allele.
- A consumer array is incomplete and is not a diagnosis. Name the upload's source and build.
- Report the call (rsID, gene, chromosome, position, genotype). Do not interpret risk, do not diagnose, and do not recommend a test or a drug.

For a drug–gene question, use `query_pharmacogenomics` (skill `mirobody-pharmacogenomics`).
