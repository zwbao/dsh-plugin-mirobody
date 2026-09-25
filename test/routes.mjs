// Every /api/mirobody/* route passes DeepSeek Harness's own check before it does anything: the
// Host/Origin/Sec-Fetch-Site fence and the dsh-auth cookie of the connection service. Without that
// service a route answers 503 and never falls open. Writes must be application/json (415 otherwise).
//
// The connection stub mirrors dsh-client-connection's requestRejection. The same code runs when another
// plugin (dsh-plugin-longpi) mounts this one with its own ctx: the service is read from the ctx given.
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'

const mod = await import('../lib/index.js')

const COOKIE = 'dsh-auth-test=good'
const GOOD = { host: '127.0.0.1:3080', cookie: COOKIE }
const PATHS = ['/api/mirobody/status', '/api/mirobody/resolve', '/api/mirobody/version']
const CONFIG = { pythonBin: '/nonexistent/python', mirobodyHome: '', mcpUrl: '', mcpToken: '', timeoutMs: 5000 }

/** dsh-client-connection's rule: loopback Host, not cross-site, Origin on the same host; then the signed cookie. */
function dshLikeRejection(req) {
  const headers = req.headers ?? {}
  if (typeof headers.host !== 'string') return 403
  let host
  try {
    host = new URL(`http://${headers.host}`)
  } catch {
    return 403
  }
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(host.hostname)) return 403
  if (headers['sec-fetch-site'] === 'cross-site') return 403
  if (typeof headers.origin === 'string') {
    try {
      if (new URL(headers.origin).host !== host.host) return 403
    } catch {
      return 403
    }
  }
  return (headers.cookie ?? '').split(';').some((part) => part.trim() === COOKIE) ? undefined : 401
}

/** A host ctx. `connection` absent means no service; `defer` holds the connection injection until provide(). */
function fakeHost({ connection, defer = false } = {}) {
  const routes = new Map()
  let pending = null
  const ctx = {
    tools: { register: () => () => {} },
    skills: { register: () => () => {} },
    systemPrompt: { section: () => {}, context: () => {} },
    webServer: { register: (route) => { routes.set(route.path, route.handler); return () => {} } },
    commands: { register: () => {} },
    ...(connection ? { connection } : {}),
    inject: (names, callback) => {
      if (names.includes('connection') && defer) pending = callback
      else callback(ctx)
    },
    on: () => () => {},
  }
  return { ctx, routes, provide: (scoped) => pending?.(scoped) }
}

function call(host, method, url, { headers = {}, body } = {}) {
  const handler = host.routes.get(url.split('?')[0])
  assert.ok(handler, `route ${url}`)
  const req = Readable.from(body === undefined ? [] : [Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))])
  req.method = method
  req.url = url
  req.headers = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]))
  return new Promise((resolveCall) => {
    const res = {
      statusCode: 200,
      writableEnded: false,
      setHeader: () => {},
      end: (text = '') => {
        res.writableEnded = true
        resolveCall({ status: res.statusCode, text: String(text) })
      },
    }
    handler(req, res)
  })
}

// --- 1. no connection service: every route refuses with 503 ----------------------------------------
{
  const host = fakeHost()
  mod.apply(host.ctx, CONFIG)
  assert.deepEqual([...host.routes.keys()].sort(), [...PATHS].sort())
  for (const path of PATHS) {
    for (const method of ['GET', 'POST']) {
      const answer = await call(host, method, path, { headers: { ...GOOD, 'content-type': 'application/json' }, body: {} })
      assert.equal(answer.status, 503, `${method} ${path} without the connection service`)
      assert.equal(answer.text, mod.CONNECTION_UNAVAILABLE)
    }
  }
}

// --- 2. the connection service decides; the plugin adds the JSON rule ------------------------------
const seen = []
const host = fakeHost({ connection: { requestRejection: (req) => { seen.push(req); return dshLikeRejection(req) } } })
mod.apply(host.ctx, CONFIG)
for (const path of PATHS) {
  for (const method of ['GET', 'POST']) {
    const json = { 'content-type': 'application/json' }
    const noCookie = await call(host, method, `${path}?q=LDL`, { headers: { host: '127.0.0.1:3080', ...json }, body: {} })
    assert.equal(noCookie.status, 401, `${method} ${path} with no cookie`)
    assert.equal(noCookie.text, 'unauthorized')
    const crossSite = await call(host, method, `${path}?q=LDL`, { headers: { ...GOOD, origin: 'https://evil.example', 'sec-fetch-site': 'cross-site', ...json }, body: {} })
    assert.equal(crossSite.status, 403, `${method} ${path} from another site`)
    assert.equal(crossSite.text, 'forbidden')
    const rebound = await call(host, method, `${path}?q=LDL`, { headers: { host: 'evil.example:3080', cookie: COOKIE, ...json }, body: {} })
    assert.equal(rebound.status, 403, `${method} ${path} with a rebound Host`)
  }
}
assert.ok(seen.length > 0 && seen.every((req) => typeof req.headers === 'object'), 'the request itself goes to requestRejection')

// Good requests reach the handlers.
const version = await call(host, 'GET', '/api/mirobody/version', { headers: GOOD })
assert.equal(version.status, 200)
assert.equal(JSON.parse(version.text).version, mod.PRODUCT_VERSION)
const status = await call(host, 'GET', '/api/mirobody/status', { headers: GOOD })
assert.equal(status.status, 200)
const statusBody = JSON.parse(status.text)
assert.equal(statusBody.engine.ok, false, 'no python at /nonexistent')
assert.equal(statusBody.mcp.configured, false)
const noQuery = await call(host, 'GET', '/api/mirobody/resolve', { headers: GOOD })
assert.equal(noQuery.status, 400, 'the resolve handler is reached')

// Writes must say application/json, with or without a charset; anything else is 415.
for (const type of [undefined, 'text/plain', 'text/plain;charset=UTF-8', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', 'application/jsonx']) {
  const headers = { ...GOOD, ...(type ? { 'content-type': type } : {}) }
  for (const path of PATHS) {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const answer = await call(host, method, `${path}?q=LDL`, { headers, body: 'q=LDL' })
      assert.equal(answer.status, 415, `${method} ${path} as ${type ?? 'no type'}`)
    }
  }
}
assert.equal((await call(host, 'POST', '/api/mirobody/version', { headers: { ...GOOD, 'content-type': 'application/json; charset=utf-8' }, body: {} })).status, 200, 'application/json with a charset is accepted')
assert.equal((await call(host, 'POST', '/api/mirobody/version', { headers: { ...GOOD, 'content-type': 'Application/JSON' }, body: {} })).status, 200, 'the media type is case-insensitive')
assert.equal(mod.isJsonRequest({ headers: { 'content-type': 'application/json' } }), true)
assert.equal(mod.isJsonRequest({ headers: {} }), false)

// A connection service that answers something unexpected, or throws, refuses.
for (const requestRejection of [() => 500, () => 'no', () => { throw new Error('boom') }]) {
  const odd = fakeHost({ connection: { requestRejection } })
  mod.apply(odd.ctx, CONFIG)
  assert.equal((await call(odd, 'GET', '/api/mirobody/version', { headers: GOOD })).status, 403)
}
// A connection object without requestRejection is no service.
const broken = fakeHost({ connection: {} })
mod.apply(broken.ctx, CONFIG)
assert.equal((await call(broken, 'GET', '/api/mirobody/version', { headers: GOOD })).status, 503)

// --- 3. the service arrives later, and goes away ---------------------------------------------------
{
  const late = fakeHost({ defer: true })
  mod.apply(late.ctx, CONFIG)
  assert.equal((await call(late, 'GET', '/api/mirobody/version', { headers: GOOD })).status, 503, 'before the service is provided')
  let active = true
  const scoped = { get connection() { if (!active) throw new Error('inactive context'); return { requestRejection: dshLikeRejection } } }
  late.provide(scoped)
  assert.equal((await call(late, 'GET', '/api/mirobody/version', { headers: GOOD })).status, 200, 'once the service is provided')
  assert.equal((await call(late, 'GET', '/api/mirobody/version', { headers: { host: '127.0.0.1:3080' } })).status, 401)
  active = false
  assert.equal((await call(late, 'GET', '/api/mirobody/version', { headers: GOOD })).status, 503, 'after the service went away: never open')
}

// --- 4. guardRoute on its own ----------------------------------------------------------------------
{
  let reached = 0
  const handler = mod.guardRoute(() => null, () => { reached += 1 })
  const answer = await new Promise((resolveCall) => {
    const res = { statusCode: 200, writableEnded: false, setHeader: () => {}, end: (text) => { res.writableEnded = true; resolveCall({ status: res.statusCode, text }) } }
    handler({ method: 'GET', headers: GOOD }, res)
  })
  assert.equal(answer.status, 503)
  assert.equal(reached, 0)
}

console.log('routes ok', { routes: PATHS.length })
