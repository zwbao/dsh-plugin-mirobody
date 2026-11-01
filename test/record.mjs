// Record tools against a Mirobody 1.5.2+ server (issue #3).
//
// 1. Parity: each record tool's declared parameters equal the TOOL_SCHEMA the installed Mirobody package
//    publishes as its MCP inputSchema, and every call shape below passes Mirobody's own validators.
//    Runs when a Python with mirobody is found (MIROBODY_PYTHON or ./.venv), like the engine smoke test.
// 2. Wire: a stand-in MCP server that answers the way mirobody/mcp/service.py does (initialize, then
//    tools/call; a refusal is `isError: true` with the envelope as JSON text and no structuredContent).
//    The plugin forwards the new parameters unchanged and reads a refusal as an error, not as data.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const mod = await import('../lib/index.js')

// --- the plugin as DSH mounts it ------------------------------------------------------------------

const tools = new Map()
const skills = []
const ctx = {
  tools: { register: (definition) => { tools.set(definition.name, definition) } },
  inject: (names, callback) => {
    if (names.includes('skills')) callback({ skills: { register: (skill) => skills.push(skill) } })
  },
  on: () => undefined,
}
const config = { pythonBin: '/nonexistent/python', mirobodyHome: '', mcpUrl: '', mcpToken: '', timeoutMs: 5000 }
mod.apply(ctx, config)

assert.deepEqual([...tools.keys()].sort(), [...mod.TOOL_NAMES].sort(), 'every TOOL_NAMES entry is registered')
assert.ok(skills.some((skill) => skill.name === 'mirobody-pharmacogenomics'))

const RECORD = ['query_health_indicators', 'query_medications', 'query_genetic_data', 'query_pharmacogenomics']
const declared = (name) => Object.keys(tools.get(name).parameters.properties).sort()
for (const name of RECORD) {
  assert.ok(!declared(name).includes('member'), `${name} has no member parameter`)
}
assert.deepEqual(tools.get('query_health_indicators').parameters.properties.view.enum,
  ['raw', 'minute', 'hour', 'day', 'week', 'month', 'stats', 'latest', 'trend'])

// Call shapes a model sends against 1.5.9. Each must pass the plugin and Mirobody's own validator.
const SHAPES = {
  query_health_indicators: [
    {},
    { keywords: ['血压'] },
    { indicators: ['LDL Cholesterol'], view: 'stats', start: '2026-01-01', end: '2026-03-31' },
    { indicators: ['Heart Rate'], view: 'trend' },
    { indicators: ['Heart Rate'], view: 'latest' },
    { indicators: ['Steps'], view: 'week' },
  ],
  query_medications: [{}, { view: 'log', keywords: ['metformin'], start: '2026-01-01' }, { view: 'history' }],
  query_genetic_data: [
    {},
    { rsids: ['rs4988235', 'rs1801133'] },
    { gene: 'CYP2C19' },
    { chromosome: '10', start: 94761900, end: 94762900, build: 'GRCh38' },
  ],
  query_pharmacogenomics: [{}, { drugs: ['clopidogrel'] }, { genes: ['CYP2C19'] }],
}

// --- 1. parity with the installed Mirobody --------------------------------------------------------

const python = [process.env.MIROBODY_PYTHON, join(root, '..', '.venv', 'bin', 'python')]
  .find((path) => path && existsSync(path)) ?? ''
const PARITY = `
import json, sys
shapes = json.loads(sys.stdin.read())
from mirobody.kernel import query, meds
from mirobody.agent.tools import genetic_service as genetic, pharmacogenomics_service as pgx
import mirobody
schemas = {
    "query_health_indicators": query.TOOL_SCHEMA,
    "query_medications": meds.TOOL_SCHEMA,
    "query_genetic_data": genetic.TOOL_SCHEMA,
    "query_pharmacogenomics": pgx.TOOL_SCHEMA,
}
def problems(name, args):
    if name == "query_health_indicators":
        out = query.validate_request(args)
    elif name == "query_medications":
        out = meds.validate_query(args)
    elif name == "query_genetic_data":
        out = genetic.validate_query(args)
    else:
        out = query.reject_unknown(args, pgx.TOOL_SCHEMA)
    return [f"{p.parameter}: {p.reason}" for p in out]
print(json.dumps({
    "version": getattr(mirobody, "__version__", "?"),
    "schemas": {name: {key: value.get("enum") for key, value in schema["properties"].items()} for name, schema in schemas.items()},
    "problems": {name: [problems(name, args) for args in calls] for name, calls in shapes.items()},
    "old": {
        "health": [f"{p.parameter}: {p.reason}" for p in query.validate_request({"indicators": ["x"], "resolution": "day", "aggregate": "stats", "member": "m"})],
        "genetic": [f"{p.parameter}: {p.reason}" for p in genetic.validate_query({"rsids": ["rs1"], "include_nearby": True})],
    },
}))
`
let parity = 'skipped (no MIROBODY_PYTHON)'
if (python) {
  const run = spawnSync(python, ['-I', '-c', PARITY], { input: JSON.stringify(SHAPES), encoding: 'utf8', timeout: 120000 })
  // The record tools' modules import Mirobody's server config (python-dotenv, ruamel.yaml, cryptography).
  // A terminology-only install lacks them: say so loudly instead of failing or passing silently.
  const missing = run.status !== 0 && /ModuleNotFoundError: No module named '([^']+)'/.exec(run.stderr ?? '')
  if (missing) {
    parity = `SKIPPED: ${python} cannot import the record tools (missing ${missing[1]}); pip install python-dotenv ruamel.yaml cryptography`
  } else {
    assert.equal(run.status, 0, run.stderr)
  }
}
if (python && !parity.startsWith('SKIPPED')) {
  const run = spawnSync(python, ['-I', '-c', PARITY], { input: JSON.stringify(SHAPES), encoding: 'utf8', timeout: 120000 })
  const server = JSON.parse(run.stdout)
  for (const name of RECORD) {
    assert.deepEqual(declared(name), Object.keys(server.schemas[name]).sort(), `${name}: plugin parameters = Mirobody ${server.version} inputSchema`)
    for (const [key, values] of Object.entries(server.schemas[name])) {
      if (values) assert.deepEqual(tools.get(name).parameters.properties[key].enum, values, `${name}.${key} enum`)
    }
    server.problems[name].forEach((found, index) => {
      assert.deepEqual(found, [], `Mirobody accepts ${name} ${JSON.stringify(SHAPES[name][index])}`)
    })
  }
  // The 0.1.1 shapes are what a 1.5.2+ server refuses: the reason this release exists.
  assert.ok(server.old.health.some((item) => item.startsWith('resolution: unknown')))
  assert.ok(server.old.health.some((item) => item.startsWith('member: unknown')))
  assert.ok(server.old.genetic.some((item) => item.startsWith('include_nearby: unknown')))
  parity = `mirobody ${server.version}`
}
for (const [name, calls] of Object.entries(SHAPES)) {
  const local = { query_health_indicators: mod.validateHealthQuery, query_medications: mod.validateMedicationQuery, query_genetic_data: mod.validateGeneticQuery }[name]
  if (local) for (const args of calls) assert.deepEqual(local(args), [], `plugin accepts ${name} ${JSON.stringify(args)}`)
}

// --- 2. the wire ---------------------------------------------------------------------------------

const HEALTH_PROPS = ['keywords', 'indicators', 'start', 'end', 'view']
const seen = []
const server = createServer((req, res) => {
  let body = ''
  req.on('data', (chunk) => { body += chunk })
  req.on('end', () => {
    const message = JSON.parse(body)
    const reply = (result, headers = {}) => {
      res.writeHead(200, { 'content-type': 'application/json', ...headers })
      res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }))
    }
    if (message.method === 'initialize') return reply({ protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'mirobody', version: '1.5.9' } }, { 'mcp-session-id': 's1' })
    if (message.method === 'notifications/initialized') { res.writeHead(202); return res.end() }
    if (message.method !== 'tools/call') { res.writeHead(400); return res.end() }
    const { name, arguments: args } = message.params
    seen.push({ name, args, session: req.headers['mcp-session-id'] })
    // The two refusals a live 1.5.9 server sends (captured 2026-11-01): an unknown argument NAME is
    // refused by the dispatcher in plain text; a bad VALUE by the tool, as its JSON envelope.
    const unknown = name === 'query_health_indicators' ? Object.keys(args).filter((key) => !HEALTH_PROPS.includes(key)).sort() : []
    if (unknown.length > 0) {
      const text = `Unknown argument(s) for ${name}: ${unknown.join(', ')}. Accepted: ${[...HEALTH_PROPS].sort().join(', ')}.`
      return reply({ content: [{ type: 'text', text }], isError: true })
    }
    if (name === 'query_health_indicators' && args.view === 'yearly') {
      const envelope = { result: 'error (invalid_arguments): view: must be one of raw, minute, hour, day, week, month, stats, latest, trend. Fix the arguments and try once more.', status: 'error', row_count: 0, truncated: false, error_kind: 'invalid_arguments' }
      return reply({ content: [{ type: 'text', text: JSON.stringify(envelope) }], isError: true })
    }
    const data = { result: `ok ${name}`, status: 'ok', row_count: 1, truncated: false }
    return reply({ content: [{ type: 'text', text: JSON.stringify(data) }], isError: false, structuredContent: data })
  })
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
config.mcpUrl = `http://127.0.0.1:${server.address().port}/mcp/secret`

const call = async (name, args) => JSON.parse(JSON.stringify(await tools.get(name).execute(args)))
try {
  const stats = await call('query_health_indicators', { indicators: ['LDL Cholesterol'], view: 'stats', start: '2026-01-01', keywords: [] })
  assert.equal(stats.status, 'ok')
  assert.deepEqual(seen.at(-1), { name: 'query_health_indicators', args: { indicators: ['LDL Cholesterol'], view: 'stats', start: '2026-01-01' }, session: 's1' }, 'forwarded unchanged, empty values dropped')

  // A parameter the server does not know reaches the server, and its refusal comes back as an error.
  const refused = await call('query_health_indicators', { indicators: ['LDL Cholesterol'], member: 'mom' })
  assert.equal(refused.success, false)
  assert.equal(refused.error_kind, 'invalid_arguments')
  assert.match(refused.error, /Unknown argument\(s\) for query_health_indicators: member\. Accepted:/)
  assert.equal(seen.at(-1).args.member, 'mom', 'the server decides, not the plugin')

  // A value outside a declared enum never leaves the harness: dsh-tools checks values against the
  // declared schema (it lets unknown NAMES through, which is why the server's own refusal matters).
  const beforeBad = seen.length
  await assert.rejects(call('query_health_indicators', { indicators: ['LDL Cholesterol'], view: 'yearly' }), { code: 'INVALID_ARGS' })
  assert.equal(seen.length, beforeBad)
  // The tool's own envelope refusal, as the server sends it for a value it refuses.
  const envelope = mod.unwrapMcpResponse({ jsonrpc: '2.0', id: 2, result: { isError: true, content: [{ type: 'text', text: JSON.stringify({ result: 'error (invalid_arguments): view: must be one of raw, minute', status: 'error', error_kind: 'invalid_arguments' }) }] } })
  assert.deepEqual([envelope.success, envelope.error_kind], [false, 'invalid_arguments'])
  assert.match(envelope.error, /view: must be one of/)

  const region = await call('query_genetic_data', { chromosome: '10', start: 94761900, end: 94762900, build: 'GRCh38', rsids: [], gene: '' })
  assert.equal(region.status, 'ok')
  assert.deepEqual(seen.at(-1).args, { chromosome: '10', start: 94761900, end: 94762900, build: 'GRCh38' })

  const pgx = await call('query_pharmacogenomics', { drugs: ['clopidogrel'] })
  assert.equal(pgx.result, 'ok query_pharmacogenomics')

  const meds = await call('query_medications', { view: 'history' })
  assert.equal(meds.status, 'ok')

  // Local refusals never reach the server.
  const before = seen.length
  const both = await call('query_health_indicators', { keywords: ['LDL'], indicators: ['LDL Cholesterol'] })
  assert.equal(both.error_kind, 'invalid_arguments')
  assert.equal(seen.length, before)
} finally {
  server.close()
}

// unwrap on its own: refusals, denials, prose, and plain success.
const denied = mod.unwrapMcpResponse({ jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: JSON.stringify({ result: 'error (denied): not yours', status: 'error', error_kind: 'denied' }) }], isError: true } })
assert.deepEqual([denied.success, denied.error_kind, denied.error], [false, 'denied', 'error (denied): not yours'])
const prose = mod.unwrapMcpResponse({ jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: 'boom' }], isError: true } })
assert.deepEqual([prose.success, prose.error_kind, prose.error], [false, 'internal', 'boom'])
const ok = mod.unwrapMcpResponse({ jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: '{}' }], isError: false, structuredContent: { result: 'x' } } })
assert.deepEqual(ok, { success: true, result: { result: 'x' } })

console.log('record ok', { parity, calls: seen.length })
