import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = dirname(fileURLToPath(import.meta.url))
const pkg = require('../package.json')

assert.equal(pkg.name, 'dsh-plugin-mirobody')
assert.equal(pkg.version, '0.1.2')
assert.equal(pkg.license, 'Apache-2.0')
assert.ok(pkg.dsh.bundle.patch)
assert.ok(pkg.dsh.client.inject.includes('slots'))

const mod = await import('../lib/index.js')
assert.equal(mod.name, 'dsh-plugin-mirobody')
assert.equal(mod.PRODUCT_VERSION, '0.1.2')
assert.equal(mod.TOOL_NAMES.length, 9)
assert.ok(mod.TOOL_NAMES.includes('query_pharmacogenomics'))
assert.deepEqual(mod.TOOL_NAMES.slice(0, 4), [
  'resolve_indicator',
  'resolve_reading',
  'convert_unit',
  'normalize_unit',
])

assert.equal(mod.preGuard('我胸痛喘不上气').code, 'emergency')
assert.equal(mod.preGuard('我想把药停了').code, 'no_medication_change')
assert.equal(mod.preGuard('我现在在吃什么药'), null)
assert.match(mod.wrapGuardMessage('胸痛', mod.preGuard('胸痛')), /120/)

const both = mod.validateHealthQuery({ keywords: ['血压'], indicators: ['Systolic'] })
assert.ok(both.some((item) => item.parameter === 'keywords+indicators'))
// Mirobody 1.5.2+ parameters pass; the server, not the plugin, decides what it accepts (issue #3).
assert.equal(mod.validateHealthQuery({ indicators: ['Heart Rate'], view: 'stats' }).length, 0)
assert.equal(mod.validateHealthQuery({ indicators: ['LDL'], view: 'trend', start: '2026-01-01', end: '2026-03-01' }).length, 0)
assert.equal(mod.validateHealthQuery({ indicators: ['LDL'], view: 'stats', value_min: 1, value_max: 3 }).length, 0, 'a newer server parameter is not refused locally')
assert.equal(mod.validateHealthQuery({ keywords: ['LDL'], start: '2026-01-01', end: '2026-03-01' }).length, 0)
assert.ok(mod.validateHealthQuery({ start: '03/01/2026' }).some((item) => item.parameter === 'start'))
assert.ok(mod.validateHealthQuery({ end: '2025-06-31' }).some((item) => item.parameter === 'end' && /calendar/.test(item.reason)))

assert.equal(mod.validateMedicationQuery({ view: 'log', keywords: ['metformin'] }).length, 0)
assert.ok(mod.validateMedicationQuery({ start: '2026-13-01' }).some((item) => item.parameter === 'start'))

assert.equal(mod.validateGeneticQuery({}).length, 0, 'no selector is the upload summary')
assert.equal(mod.validateGeneticQuery({ rsids: ['rs4988235'] }).length, 0)
assert.equal(mod.validateGeneticQuery({ gene: 'CYP2C19' }).length, 0)
assert.equal(mod.validateGeneticQuery({ chromosome: '10', start: 94761900, end: 94762900, build: 'GRCh38' }).length, 0, 'start/end are coordinates, not dates')
assert.ok(mod.validateGeneticQuery({ rsids: ['CYP2C19*2'] }).some((item) => item.parameter === 'rsids'))
assert.ok(mod.validateGeneticQuery({ rsids: Array.from({ length: 51 }, (_, i) => `rs${i + 1}`) }).some((item) => /50/.test(item.reason)))

for (const name of ['terminology', 'readings', 'medications', 'genetics', 'pharmacogenomics']) {
  const raw = readFileSync(join(root, '..', 'skills', name, 'SKILL.md'), 'utf8')
  assert.match(raw, /^---\nname: mirobody-/)
  assert.match(raw, /description:/)
}

// The bridge gets a minimal environment: never the harness's own keys or tokens.
{
  const saved = { ...process.env }
  process.env.DEEPSEEK_API_KEY = 'sk-should-not-leak'
  process.env.MIROBODY_LEAK_TEST = 'x'
  process.env.PYTHONPATH = '/should/not/pass'
  process.env.TMPDIR = process.env.TMPDIR || '/tmp'
  const ALLOWED = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TMPDIR', 'MIROBODY_HOME', 'PYTHONNOUSERSITE', 'PYTHONDONTWRITEBYTECODE']
  const env = mod.bridgeEnv(' /opt/mirobody ')
  assert.deepEqual(Object.keys(env).filter((key) => !ALLOWED.includes(key)), [], 'only the allowed variables')
  assert.equal(env.MIROBODY_HOME, '/opt/mirobody')
  assert.equal(env.PYTHONNOUSERSITE, '1')
  assert.equal(env.PATH, process.env.PATH)
  assert.equal(env.TMPDIR, process.env.TMPDIR)
  assert.ok(env.LANG)
  // End to end: a stand-in interpreter that prints the environment it was started with.
  const dir = mkdtempSync(join(tmpdir(), 'mirobody-env-'))
  try {
    const fake = join(dir, 'fake-python')
    writeFileSync(fake, `#!${process.execPath}\nprocess.stdout.write(JSON.stringify(process.env))\n`)
    chmodSync(fake, 0o755)
    const seen = mod.runBridgeSync(fake, '', { op: 'status' }, 20000)
    assert.equal(seen.DEEPSEEK_API_KEY, undefined, 'no API key reaches the bridge')
    assert.equal(seen.MIROBODY_LEAK_TEST, undefined)
    assert.equal(seen.PYTHONPATH, undefined)
    assert.equal(seen.PYTHONNOUSERSITE, '1')
    // macOS adds __CF_USER_TEXT_ENCODING to every process it starts; nothing else may appear.
    assert.deepEqual(Object.keys(seen).filter((key) => !ALLOWED.includes(key) && !key.startsWith('__CF_')), [], `bridge env: ${Object.keys(seen).join(', ')}`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]
    Object.assign(process.env, saved)
  }
}

const python = [process.env.MIROBODY_PYTHON, join(root, '..', '.venv', 'bin', 'python')]
  .find((path) => path && existsSync(path)) ?? ''
if (python) {
  const resolved = mod.runBridgeSync(python, '', { op: 'resolve', names: ['血红蛋白', '血脂'] }, 120000)
  assert.equal(resolved.ok, true, JSON.stringify(resolved))
  const rows = resolved.results
  assert.ok(Array.isArray(rows))
  const hb = rows.find((row) => row.name === '血红蛋白')
  const lipids = rows.find((row) => row.name === '血脂')
  assert.equal(hb.loinc, '718-7')
  assert.equal(hb.resolved, true)
  assert.equal(lipids.resolved, false)
  const reading = mod.runBridgeSync(python, '', {
    op: 'resolve_reading',
    name: 'total cholesterol',
    value: '5.0',
    unit: 'mmol/L',
  }, 120000)
  assert.equal(reading.ok, true, JSON.stringify(reading))
  assert.equal(reading.result.loinc, '14647-2')
  const units = mod.runBridgeSync(python, '', { op: 'normalize', units: ['mg/dL'] }, 120000)
  assert.equal(units.ok, true, JSON.stringify(units))
  assert.ok(units.results[0].ucum)
  console.log('engine ok', { loinc: hb.loinc, cholesterol: reading.result.loinc, ucum: units.results[0].ucum })
} else {
  console.log('engine skipped (no MIROBODY_PYTHON)')
}

console.log('smoke ok', { version: pkg.version, tools: mod.TOOL_NAMES.length })
