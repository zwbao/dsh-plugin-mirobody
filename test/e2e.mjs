// End to end against a live Mirobody server. Skipped unless MIROBODY_E2E_MCP_URL is set:
//
//   MIROBODY_E2E_MCP_URL=http://127.0.0.1:18060/mcp/<personal-secret> node test/e2e.mjs
//   (or MIROBODY_E2E_MCP_URL=http://127.0.0.1:18060/mcp MIROBODY_E2E_TOKEN=<jwt>)
//
// The account needs readings (SEED_DEMO_DATA=true gives them), at least one medication plan and an
// active genotype upload, or the server hides query_medications / query_genetic_data /
// query_pharmacogenomics from tools/list and this test says which data is missing.
//
// What it checks, through the plugin exactly as DSH mounts it:
//   1. tools/list: each record tool's server inputSchema has the same parameters and enums the plugin
//      declares (the issue's own suggestion, against the real server rather than the package).
//   2. every call shape the 1.5.2+ grammar allows comes back `status: ok` from the real server;
//   3. a parameter the server does not know is refused BY THE SERVER, and the plugin reports it as
//      `invalid_arguments` naming the parameter, not as data.
import assert from 'node:assert/strict'

const url = process.env.MIROBODY_E2E_MCP_URL?.trim() ?? ''
if (!url) {
  console.log('e2e skipped (no MIROBODY_E2E_MCP_URL)')
  process.exit(0)
}
const token = process.env.MIROBODY_E2E_TOKEN?.trim() ?? ''
const mod = await import('../lib/index.js')

const tools = new Map()
const ctx = {
  tools: { register: (definition) => { tools.set(definition.name, definition) } },
  inject: () => undefined,
  on: () => undefined,
}
mod.apply(ctx, { pythonBin: '/nonexistent/python', mirobodyHome: '', mcpUrl: url, mcpToken: token, timeoutMs: 60000 })

// --- 1. the live server's own schemas --------------------------------------------------------------

async function rpc(method, params, session = '') {
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' }
  if (token) headers.authorization = `Bearer ${token}`
  if (session) headers['mcp-session-id'] = session
  const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
  assert.equal(response.status, 200, `${method}: HTTP ${response.status}`)
  const text = await response.text()
  const payload = text.trim().startsWith('{') ? text : text.split('\n').filter((line) => line.startsWith('data:')).at(-1).slice(5)
  return { body: JSON.parse(payload), session: response.headers.get('mcp-session-id') ?? session }
}
const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '0' } })
const serverVersion = init.body.result?.serverInfo?.version ?? '?'
const listed = new Map((await rpc('tools/list', {}, init.session)).body.result.tools.map((tool) => [tool.name, tool.inputSchema]))

const RECORD = {
  query_health_indicators: 'readings (SEED_DEMO_DATA=true)',
  query_medications: 'a medication plan',
  query_genetic_data: 'an active genotype upload',
  query_pharmacogenomics: 'an active genotype upload',
}
const hidden = Object.entries(RECORD).filter(([name]) => !listed.has(name))
assert.deepEqual(hidden.map(([name, need]) => `${name} needs ${need}`), [], 'the account has every kind of data')
for (const name of Object.keys(RECORD)) {
  const server = listed.get(name).properties
  const plugin = tools.get(name).parameters.properties
  assert.deepEqual(Object.keys(plugin).sort(), Object.keys(server).sort(), `${name}: plugin parameters = live inputSchema`)
  for (const [key, schema] of Object.entries(server)) {
    if (schema.enum) assert.deepEqual(plugin[key].enum, schema.enum, `${name}.${key} enum`)
  }
}

// --- 2. every view and selector through the plugin ------------------------------------------------

const call = async (name, args) => JSON.parse(JSON.stringify(await tools.get(name).execute(args)))
const results = []
async function expectOk(name, args) {
  const out = await call(name, args)
  assert.notEqual(out.success, false, `${name} ${JSON.stringify(args)}: ${out.error_kind} ${out.error}`)
  // partial = answered, but the server cut rows to its cap and says how to get the rest.
  assert.ok(['ok', 'partial'].includes(out.status), `${name} ${JSON.stringify(args)}: ${JSON.stringify(out).slice(0, 300)}`)
  assert.equal(typeof out.result, 'string')
  results.push({ name, args, status: out.status, row_count: out.row_count, truncated: out.truncated })
  return out
}

const catalogue = await expectOk('query_health_indicators', {})
assert.ok(catalogue.row_count > 0, 'the catalogue lists this person\'s indicators')
// One exact name from the catalogue, the way the skill tells the model to work.
const lines = catalogue.result.split('\n').filter((line) => line.includes('|'))
const header = lines[0].split('|').map((cell) => cell.trim())
const column = header.indexOf('name') >= 0 ? header.indexOf('name') : header.indexOf('indicator')
assert.ok(column >= 0, `catalogue header: ${lines[0]}`)
const numeric = lines.slice(1).map((line) => line.split('|')[column]?.trim()).filter(Boolean)
const indicator = numeric.find((name) => /heart|steps|weight|glucose|cholesterol|心率|步数/i.test(name)) ?? numeric[0]

await expectOk('query_health_indicators', { keywords: ['heart rate', '心率'] })
for (const view of ['raw', 'minute', 'hour', 'day', 'week', 'month', 'stats', 'latest', 'trend']) {
  await expectOk('query_health_indicators', { indicators: [indicator], view })
}
const windowed = await expectOk('query_health_indicators', { indicators: [indicator], view: 'stats', start: '2026-01-01', end: '2026-12-31' })
assert.match(windowed.result, /2026-01-01|window/i)

const plan = await expectOk('query_medications', {})
assert.ok(plan.row_count > 0, 'at least one plan')
await expectOk('query_medications', { view: 'log' })
await expectOk('query_medications', { view: 'history', start: '2025-01-01' })
await expectOk('query_medications', { view: 'plan', keywords: [plan.result.split('\n').find((line) => /\|/.test(line) && !/medication/i.test(line))?.split('|').map((cell) => cell.trim()).find(Boolean) ?? 'a'] })

await expectOk('query_genetic_data', {})
await expectOk('query_genetic_data', { rsids: ['rs4244285', 'rs4988235'] })
await expectOk('query_genetic_data', { gene: 'CYP2C19' })
await expectOk('query_genetic_data', { chromosome: '10', start: 96500000, end: 96800000, build: 'GRCh37' })

await expectOk('query_pharmacogenomics', {})
await expectOk('query_pharmacogenomics', { drugs: ['clopidogrel'] })
await expectOk('query_pharmacogenomics', { genes: ['CYP2C19'] })

// --- 3. the server refuses, the plugin reports ----------------------------------------------------

for (const [name, args, parameter] of [
  ['query_health_indicators', { indicators: [indicator], member: 'mom' }, 'member'],
  ['query_health_indicators', { indicators: [indicator], resolution: 'day', aggregate: 'stats' }, 'resolution'],
  ['query_medications', { member: 'mom' }, 'member'],
  ['query_genetic_data', { rsids: ['rs4244285'], include_nearby: true }, 'include_nearby'],
  // A value the declared schema allows but the tool refuses: the tool's own envelope.
  ['query_genetic_data', { chromosome: 'Z', start: 1, end: 100, build: 'GRCh38' }, 'chromosome'],
]) {
  const out = await call(name, args)
  assert.equal(out.success, false, `${name} ${JSON.stringify(args)} is refused: ${JSON.stringify(out).slice(0, 300)}`)
  assert.equal(out.error_kind, 'invalid_arguments')
  assert.match(out.error, new RegExp(parameter))
  results.push({ name, args, refused: out.error })
}

// A value outside a declared enum is stopped by dsh-tools before any request is sent.
await assert.rejects(call('query_health_indicators', { indicators: [indicator], view: 'yearly' }), { code: 'INVALID_ARGS' })

console.log(JSON.stringify(results.map((row) => row.refused ? `${row.name} ${JSON.stringify(row.args)} -> refused: ${row.refused}` : `${row.name} ${JSON.stringify(row.args)} -> ${row.status} rows=${row.row_count}${row.truncated ? ' (truncated)' : ''}`), null, 1))
console.log('e2e ok', { server: serverVersion, indicator, calls: results.length })
