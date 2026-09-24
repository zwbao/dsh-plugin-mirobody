export interface Rejection {
  parameter: string
  reason: string
}

const RESOLUTIONS = ['raw', 'minute', 'hour', 'day', 'week', 'month'] as const
const AGGREGATES = ['none', 'stats', 'latest'] as const
const MED_VIEWS = ['plan', 'log', 'history'] as const

const DISPATCH = new Set<string>([
  'raw|none',
  'raw|stats',
  'raw|latest',
  'minute|none',
  'minute|stats',
  'hour|none',
  'hour|stats',
  'day|none',
  'day|stats',
  'day|latest',
  'week|none',
  'week|stats',
  'week|latest',
  'month|none',
  'month|stats',
  'month|latest',
])

const DATE = /^\d{4}-\d{2}-\d{2}$/

function present(value: unknown): boolean {
  return value !== undefined && value !== null && value !== '' && !(Array.isArray(value) && value.length === 0)
}

function rejectUnknown(args: Record<string, unknown>, allowed: readonly string[]): Rejection[] {
  return Object.keys(args)
    .filter((key) => !allowed.includes(key))
    .sort()
    .map((parameter) => ({ parameter, reason: 'unknown parameter' }))
}

function rejectDates(args: Record<string, unknown>): Rejection[] {
  const out: Rejection[] = []
  for (const parameter of ['start', 'end'] as const) {
    const value = args[parameter]
    if (present(value) && !DATE.test(String(value))) {
      out.push({ parameter, reason: 'must be YYYY-MM-DD' })
    }
  }
  return out
}

export function formatRejections(problems: readonly Rejection[]): string {
  return problems.map((item) => `${item.parameter}: ${item.reason}`).join('; ')
}

export function validateHealthQuery(args: Record<string, unknown>): Rejection[] {
  const out = rejectUnknown(args, [
    'keywords',
    'indicators',
    'start',
    'end',
    'resolution',
    'aggregate',
    'limit',
    'member',
  ])
  const resolution = args.resolution
  const aggregate = args.aggregate
  if (present(resolution) && !RESOLUTIONS.includes(resolution as (typeof RESOLUTIONS)[number])) {
    out.push({ parameter: 'resolution', reason: `must be one of ${RESOLUTIONS.join(', ')}` })
  }
  if (present(aggregate) && !AGGREGATES.includes(aggregate as (typeof AGGREGATES)[number])) {
    out.push({ parameter: 'aggregate', reason: `must be one of ${AGGREGATES.join(', ')}` })
  }
  const selectors = ['keywords', 'indicators'].filter((key) => present(args[key]))
  if (selectors.length > 1) {
    out.push({ parameter: 'keywords+indicators', reason: 'give keywords or indicators — not both' })
  }
  const res = String(resolution || 'raw')
  const agg = String(aggregate || 'none')
  if (
    RESOLUTIONS.includes(res as (typeof RESOLUTIONS)[number])
    && AGGREGATES.includes(agg as (typeof AGGREGATES)[number])
    && !DISPATCH.has(`${res}|${agg}`)
  ) {
    out.push({ parameter: 'aggregate', reason: `${agg} is not defined for resolution=${res}` })
  }
  if (selectors.length === 0 && agg !== 'none') {
    out.push({ parameter: 'aggregate', reason: 'the catalogue cannot be aggregated; pick indicators first' })
  }
  if (selectors.length === 0 && res !== 'raw') {
    out.push({ parameter: 'resolution', reason: 'the catalogue has no resolution; pick indicators first' })
  }
  if ((res !== 'raw' || agg !== 'none') && present(args.limit)) {
    out.push({ parameter: 'limit', reason: 'only applies to raw rows without aggregation' })
  }
  const limit = args.limit
  if (present(limit) && (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 500)) {
    out.push({ parameter: 'limit', reason: 'must be an integer between 1 and 500' })
  }
  out.push(...rejectDates(args))
  return out
}

export function validateMedicationQuery(args: Record<string, unknown>): Rejection[] {
  const out = rejectUnknown(args, ['view', 'keywords', 'start', 'end', 'member'])
  const view = args.view
  if (present(view) && !MED_VIEWS.includes(view as (typeof MED_VIEWS)[number])) {
    out.push({ parameter: 'view', reason: `must be one of ${MED_VIEWS.join(', ')}` })
  }
  out.push(...rejectDates(args))
  return out
}

export function validateGeneticQuery(args: Record<string, unknown>): Rejection[] {
  const out = rejectUnknown(args, ['rsids', 'include_nearby', 'nearby_range', 'limit', 'member'])
  const rsids = args.rsids
  if (!Array.isArray(rsids) || rsids.length === 0 || rsids.every((item) => typeof item !== 'string' || !item.trim())) {
    out.push({ parameter: 'rsids', reason: 'name at least one rsID; this tool has no catalogue to browse' })
  } else if (rsids.length > 50) {
    out.push({ parameter: 'rsids', reason: 'at most 50 rsIDs per call' })
  }
  const limit = args.limit
  if (present(limit) && (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 500)) {
    out.push({ parameter: 'limit', reason: 'must be an integer between 1 and 500' })
  }
  const range = args.nearby_range
  if (present(range) && (typeof range !== 'number' || !Number.isInteger(range) || range < 1)) {
    out.push({ parameter: 'nearby_range', reason: 'must be a positive number of base pairs' })
  }
  const nearby = args.include_nearby
  if (present(nearby) && typeof nearby !== 'boolean') {
    out.push({ parameter: 'include_nearby', reason: 'must be true or false' })
  }
  return out
}

export function invalidArguments(problems: readonly Rejection[]): {
  success: false
  error_kind: 'invalid_arguments'
  error: string
  hint: string
} {
  return {
    success: false,
    error_kind: 'invalid_arguments',
    error: formatRejections(problems),
    hint: 'The arguments were not accepted. Check the tool parameter list and try once with corrected arguments.',
  }
}
