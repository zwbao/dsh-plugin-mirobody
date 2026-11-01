import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Config } from './config.ts'
import { discoverPython, runBridge, type EngineResult } from './engine.ts'
import { callMcpTool, mcpHost } from './mcp.ts'
import { asJson } from './json.ts'
import { invalidArguments, validateGeneticQuery, validateHealthQuery, validateMedicationQuery } from './validate.ts'

function jsonText(value: unknown): [{ type: 'text'; text: string }] {
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
}

function dropEmpty(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(args)) {
    if (value === undefined || value === null || value === '') continue
    if (Array.isArray(value) && value.length === 0) continue
    out[key] = value
  }
  return out
}

async function engine(config: Config, payload: Record<string, unknown>): Promise<EngineResult> {
  return runBridge(discoverPython(config.pythonBin), config.mirobodyHome, payload, config.timeoutMs)
}

async function record(
  config: Config,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const called = await callMcpTool({
    url: config.mcpUrl,
    token: config.mcpToken,
    name,
    args: dropEmpty(args),
    timeoutMs: config.timeoutMs,
  })
  if (called.success === false) return called
  return called.result ?? called
}

const jsonOut = {
  schema: { type: 'json' as const },
  render: (_args: unknown, value: unknown) => jsonText(value),
}

export function registerTools(ctx: Context, config: () => Config): void {
  ctx.tools.register(defineTool({
    name: 'resolve_indicator',
    description: 'Resolve health indicator names to canonical LOINC codes. Offline, no user record, no network. Any language and clinical shorthand: "LDL-C", "低密度脂蛋白胆固醇" and "ヘモグロビン" resolve here. Use before storing a reading, comparing labs, or treating two names as the same test. Unresolved is an honest no: report it unmatched and never invent a code. Panel names such as "blood pressure" or "血脂" deliberately do not resolve; ask for the specific measurement. Pass the printed value and unit to resolve_reading when you have them, because a different unit is a different LOINC code. Same code from two names means the same test.',
    parameters: {
      names: {
        type: 'array',
        items: { type: 'string' },
        required: true,
        description: 'Names exactly as printed. Pass the whole batch in one call, at most 200.',
      },
    },
    output: jsonOut,
    timeoutMs: 60000,
    isConcurrencySafe: () => true,
    async execute(args) {
      return asJson(await engine(config(), { op: 'resolve', names: args.names }))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'resolve_reading',
    description: 'Resolve one printed reading (name + value + unit) to the LOINC code that identity implies. Offline. A name alone is several codes: total cholesterol in mmol/L is 14647-2 and in mg/dL is 2093-3; a neutrophil percentage and a neutrophil count are different codes. Use this whenever the value and unit are known. Use resolve_indicator only for a bare name. Unresolved means the engine refused to guess. Do not invent a code, and do not scale the number yourself.',
    parameters: {
      name: {
        type: 'string',
        required: true,
        description: 'Indicator name exactly as printed, any language.',
      },
      value: {
        type: 'string',
        required: true,
        description: 'The number as printed, including a percent sign when that is what the report shows, e.g. "5.0" or "62 %".',
      },
      unit: {
        type: 'string',
        description: 'Unit as printed, e.g. "mmol/L". Omit only when the report has none.',
      },
    },
    output: jsonOut,
    timeoutMs: 60000,
    isConcurrencySafe: () => true,
    async execute(args) {
      return asJson(await engine(config(), {
        op: 'resolve_reading',
        name: args.name,
        value: args.value,
        unit: args.unit ?? '',
      }))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'convert_unit',
    description: 'Convert one measurement between units. Offline, no user data. Use this before comparing or charting readings recorded in different units. Never scale a value by hand. converted null is an answer, not a failure: the units are not interconvertible (a percentage is not an absolute count, or the molar mass is not carried for that LOINC). Report those readings separately with their own units. Pass loinc_code to cross mass and substance concentration (mg/dL and mmol/L). Omit it for same-dimension conversions.',
    parameters: {
      value: {
        type: 'number',
        required: true,
        description: 'The number as recorded, e.g. 5.6.',
      },
      from_unit: {
        type: 'string',
        required: true,
        description: 'Unit it is in now, as printed, e.g. "mmol/L".',
      },
      to_unit: {
        type: 'string',
        required: true,
        description: 'Unit wanted, e.g. "mg/dL".',
      },
      loinc_code: {
        type: 'string',
        description: 'The reading\'s LOINC code. Required only to cross mass and substance concentration.',
      },
    },
    output: jsonOut,
    timeoutMs: 60000,
    isConcurrencySafe: () => true,
    async execute(args) {
      return asJson(await engine(config(), {
        op: 'convert',
        value: args.value,
        from_unit: args.from_unit,
        to_unit: args.to_unit,
        loinc_code: args.loinc_code ?? '',
      }))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'normalize_unit',
    description: 'Normalize free-text measurement units to canonical UCUM. Offline, no user data. The same unit is written many ways ("mg/dL", "MG/DL", "毫摩尔每升"): normalize before comparing or converting. family classifies the LOINC property; it does NOT say what converts. kg/m2 and mg/dL can share a family and still be inconvertible, while U/L and [IU]/L can be the same unit in different families. Call convert_unit for that question. An empty ucum means unrecognized: say so rather than assuming.',
    parameters: {
      units: {
        type: 'array',
        items: { type: 'string' },
        required: true,
        description: 'Unit strings as printed, at most 200, e.g. ["mg/dL", "毫摩尔每升", "次/分"].',
      },
    },
    output: jsonOut,
    timeoutMs: 60000,
    isConcurrencySafe: () => true,
    async execute(args) {
      return asJson(await engine(config(), { op: 'normalize', units: args.units }))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'query_health_indicators',
    description: 'Read one person\'s health record from their Mirobody server: readings (labs, vitals, wearable metrics) and what they reported (symptoms, diagnoses they were given, notes, in their own words). Read-only. Omit both keywords and indicators to get the catalogue of what this person has. Use keywords when the exact name is unknown, then copy exact indicator names into a later call. Pick one view: raw (default) is the readings, newest first, each with its file; minute/hour/day/week/month is one point per period, for a chart; stats is count/min/max/avg/sum/first/last/change over the window (use it for totals, "how often" and a baseline; do not add rows up yourself); trend is numeric direction and shape over the daily series; latest is the most recent value per indicator. Give keywords or indicators, not both. Dates are YYYY-MM-DD in the person\'s zone; omit both for the whole record. The server caps rows and says when it cut them: narrow the window or use stats. Absence means not on file, not "normal". A reported condition is self-reported. Every number you cite must come from this result. Do not call twice with the same arguments. Requires mcpUrl.',
    parameters: {
      keywords: {
        type: 'array',
        items: { type: 'string' },
        description: 'Free-text terms against the person\'s catalogue, any language (e.g. ["blood pressure", "血压"], or a symptom such as ["headache"]). At most 20. Omit both keywords and indicators for the catalogue.',
      },
      indicators: {
        type: 'array',
        items: { type: 'string' },
        description: 'Exact indicator names copied from a previous result, at most 50. Preferred once known.',
      },
      start: { type: 'string', description: 'First local date, inclusive (YYYY-MM-DD, the person\'s time zone). Omit both dates for the whole record.' },
      end: { type: 'string', description: 'Last local date, inclusive (YYYY-MM-DD).' },
      view: {
        type: 'string',
        enum: ['raw', 'minute', 'hour', 'day', 'week', 'month', 'stats', 'latest', 'trend'],
        description: 'raw (default): readings, newest first. minute/hour/day/week/month: one point per period. stats: count/min/max/avg/sum/first/last/change. trend: direction and shape of the daily series. latest: most recent value per indicator.',
      },
    },
    output: jsonOut,
    timeoutMs: 60000,
    isConcurrencySafe: () => true,
    async execute(args) {
      const problems = validateHealthQuery(args)
      if (problems.length > 0) return asJson(invalidArguments(problems))
      return asJson(await record(config(), 'query_health_indicators', args))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'query_medications',
    description: 'Read this person\'s medications from their Mirobody server. Read-only: it cannot add, change, or stop a medication. view=plan is the list they intend to take, with status and today\'s dose states — NOT an intake record. view=log is doses actually recorded taken or skipped (default window: last 30 days). view=history is courses with start, end, and why they ended, which is how a "when did I switch" question gets a date for query_health_indicators. A plan is not evidence a dose was swallowed. A dose missing from the log is not evidence it was not taken. The server reads only the account the token or personal link belongs to. Do not use this for drug information, interactions, or dose advice. Requires mcpUrl.',
    parameters: {
      view: {
        type: 'string',
        enum: ['plan', 'log', 'history'],
        description: 'plan (default), log, or history.',
      },
      keywords: {
        type: 'array',
        items: { type: 'string' },
        description: 'Drug names or codes to narrow to, any language, at most 20. Omit for every medication.',
      },
      start: { type: 'string', description: 'First local date, inclusive (YYYY-MM-DD).' },
      end: { type: 'string', description: 'Last local date, inclusive (YYYY-MM-DD).' },
    },
    output: jsonOut,
    timeoutMs: 60000,
    isConcurrencySafe: () => true,
    async execute(args) {
      const problems = validateMedicationQuery(args)
      if (problems.length > 0) return asJson(invalidArguments(problems))
      return asJson(await record(config(), 'query_medications', args))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'query_genetic_data',
    description: 'Read this person\'s genotype calls from the genotype file they uploaded to Mirobody. Read-only. Choose ONE selector per call: rsids (at most 50 dbSNP ids), gene (an HGNC symbol such as CYP2C19), or a region (chromosome + start + end + build). With no selector it returns only a summary of the upload (vendor, build, rows). A locus missing from the result, a no-call, or an unresolved call is not a normal genotype and not evidence about the allele. Genotypes are unphased: "AG" does not say which parent contributed which allele. A consumer array is not a diagnosis. Report the call and state the upload\'s source and build. Do not interpret risk, do not diagnose, and do not turn a call into a treatment. Requires mcpUrl.',
    parameters: {
      rsids: {
        type: 'array',
        items: { type: 'string' },
        description: 'dbSNP identifiers, e.g. ["rs4988235", "rs1801133"]. At most 50.',
      },
      gene: { type: 'string', description: 'HGNC gene symbol, e.g. CYP2C19.' },
      chromosome: { type: 'string', description: 'Chromosome for a region query: 1–22, X, Y, PAR, or MT.' },
      start: { type: 'integer', description: 'Region start coordinate, inclusive, in the chosen build (≥ 1).' },
      end: { type: 'integer', description: 'Region end coordinate, inclusive, in the chosen build.' },
      build: {
        type: 'string',
        enum: ['GRCh37', 'GRCh38', 'raw'],
        description: 'Required with a region. raw uses the upload\'s own, unverified positions (the only choice for PAR).',
      },
    },
    output: jsonOut,
    timeoutMs: 60000,
    isConcurrencySafe: () => true,
    async execute(args) {
      const problems = validateGeneticQuery(args)
      if (problems.length > 0) return asJson(invalidArguments(problems))
      return asJson(await record(config(), 'query_genetic_data', args))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'query_pharmacogenomics',
    description: 'Check CPIC level A/B drug–gene pairs against the person\'s uploaded genotype file on their Mirobody server, and say which defining sites the upload typed, missed, or could not call. Read-only. Name drugs (exact CPIC generic names) and/or genes (HGNC symbols), at most 10 each; with neither, it checks the person\'s active medication plans. A CPIC level says a guideline exists for that gene–drug pair; it is NOT this person\'s phenotype or diplotype, and the server returns no prescribing advice. Missing or no-call sites never mean a normal diplotype; an array cannot establish phase or copy number. No matching pair does not prove there is no interaction. These rows carry no rid: cite a genotype from query_genetic_data. Never advise starting, stopping, or changing a medicine or a dose. Requires mcpUrl.',
    parameters: {
      drugs: {
        type: 'array',
        items: { type: 'string' },
        description: 'Exact CPIC generic drug names, e.g. ["clopidogrel"]. At most 10. Omit with genes to check current medication plans.',
      },
      genes: {
        type: 'array',
        items: { type: 'string' },
        description: 'HGNC symbols, e.g. ["CYP2C19"]. At most 10. Omit with drugs to check current medication plans.',
      },
    },
    output: jsonOut,
    timeoutMs: 60000,
    isConcurrencySafe: () => true,
    async execute(args) {
      return asJson(await record(config(), 'query_pharmacogenomics', args))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'mirobody_status',
    description: 'Report whether the offline Mirobody engine imports and whether a record server URL is configured. Use this when a terminology or record tool failed, or before telling the user that labs are unavailable. Does not return health records. The token and any credential embedded in the MCP URL are not included.',
    parameters: {},
    output: jsonOut,
    timeoutMs: 60000,
    isConcurrencySafe: () => true,
    async execute() {
      const current = config()
      const status = await engine(current, { op: 'status' })
      return asJson({
        engine: status,
        mcp: {
          configured: Boolean(current.mcpUrl.trim()),
          host: mcpHost(current.mcpUrl),
          token_set: Boolean(current.mcpToken.trim()),
        },
        python_bin: discoverPython(current.pythonBin),
      })
    },
  }))
}
