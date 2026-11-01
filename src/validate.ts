/**
 * Local checks before a record call leaves the harness.
 *
 * The Mirobody server is the authority on its own parameters: it rejects an unknown or malformed
 * argument with a per-parameter reason (`error_kind: invalid_arguments`), and that answer reaches the
 * model unchanged. So the plugin does not keep its own copy of the server's grammar. Mirobody 1.5.2
 * replaced resolution × aggregate with one `view` and dropped `member`; a plugin that refused unknown
 * parameters locally broke every record call against it (issue #3). Only shape checks the tool
 * schema cannot express stay here, and each of them matches what the server says.
 */
export interface Rejection {
  parameter: string
  reason: string
}

const DATE = /^\d{4}-\d{2}-\d{2}$/
const RSID = /^rs\d+$/

function present(value: unknown): boolean {
  return value !== undefined && value !== null && value !== '' && !(Array.isArray(value) && value.length === 0)
}

/** `YYYY-MM-DD` that is also a real calendar day (2025-06-31 is not). */
function rejectDates(args: Record<string, unknown>): Rejection[] {
  const out: Rejection[] = []
  for (const parameter of ['start', 'end'] as const) {
    const value = args[parameter]
    if (!present(value)) continue
    const text = String(value)
    if (!DATE.test(text)) {
      out.push({ parameter, reason: 'must be YYYY-MM-DD' })
      continue
    }
    const day = new Date(`${text}T00:00:00Z`)
    if (Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== text) {
      out.push({ parameter, reason: 'not a calendar date' })
    }
  }
  return out
}

export function formatRejections(problems: readonly Rejection[]): string {
  return problems.map((item) => `${item.parameter}: ${item.reason}`).join('; ')
}

export function validateHealthQuery(args: Record<string, unknown>): Rejection[] {
  const out: Rejection[] = []
  if (present(args.keywords) && present(args.indicators)) {
    out.push({ parameter: 'keywords+indicators', reason: 'give keywords or indicators — not both' })
  }
  out.push(...rejectDates(args))
  return out
}

export function validateMedicationQuery(args: Record<string, unknown>): Rejection[] {
  return rejectDates(args)
}

/** `start`/`end` here are genomic coordinates (integers), not dates; the server checks the region. */
export function validateGeneticQuery(args: Record<string, unknown>): Rejection[] {
  const out: Rejection[] = []
  const rsids = args.rsids
  if (present(rsids)) {
    if (!Array.isArray(rsids)) {
      out.push({ parameter: 'rsids', reason: 'must be a list of rsIDs' })
    } else {
      if (rsids.length > 50) out.push({ parameter: 'rsids', reason: 'at most 50 rsIDs per call' })
      if (rsids.some((item) => typeof item !== 'string' || !RSID.test(item.trim()))) {
        out.push({ parameter: 'rsids', reason: 'each identifier must be an rsID' })
      }
    }
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
