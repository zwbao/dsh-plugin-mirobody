import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { Config } from './config.ts'
import { discoverPython, runBridgeSync } from './engine.ts'
import { mcpHost } from './mcp.ts'
import { PRODUCT_NAME, PRODUCT_VERSION, TOOL_NAMES } from './version.ts'

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.writableEnded) return
  const text = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(text)
}

function sendText(res: ServerResponse, status: number, text: string): void {
  if (res.writableEnded) return
  res.statusCode = status
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(text)
}

function queryNames(url: string | undefined): string[] {
  if (!url) return []
  const parsed = new URL(url, 'http://127.0.0.1')
  return parsed.searchParams.getAll('q').map((item) => item.trim()).filter(Boolean).slice(0, 20)
}

type Handler = (req: IncomingMessage, res: ServerResponse) => void

/**
 * The part of DSH's `connection` service (dsh-client-connection, HostConnectionHandle) the routes use:
 * the Host/Origin/Sec-Fetch-Site fence, then the signed `dsh-auth` cookie. 401 or 403 rejects.
 */
export interface ConnectionGuard {
  requestRejection(request: { headers: IncomingMessage['headers'] }): 401 | 403 | undefined
}

export const CONNECTION_UNAVAILABLE = 'mirobody: DeepSeek Harness connection service unavailable'
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/** application/json, with or without a charset or other parameters. */
export function isJsonRequest(req: Pick<IncomingMessage, 'headers'>): boolean {
  const type = req.headers['content-type']
  return typeof type === 'string' && (type.split(';', 1)[0] ?? '').trim().toLowerCase() === 'application/json'
}

/**
 * DSH's exact routes skip the /api prefix route and its checks, so every Mirobody handler runs them itself,
 * before anything else: no connection service, no route (503); then DSH's own rejection; then a write
 * that is not JSON (415), which a page on another site could otherwise send without a preflight.
 */
export function guardRoute(connection: () => ConnectionGuard | null, handler: Handler): Handler {
  return (req, res) => {
    const service = connection()
    if (!service) {
      sendText(res, 503, CONNECTION_UNAVAILABLE)
      return
    }
    let rejection: number | undefined
    try {
      rejection = service.requestRejection(req)
    } catch {
      rejection = 403
    }
    if (rejection !== undefined) {
      // Anything but 401 is refused as 403: an unknown answer never lets a request through.
      sendText(res, rejection === 401 ? 401 : 403, rejection === 401 ? 'unauthorized' : 'forbidden')
      return
    }
    if (WRITE_METHODS.has((req.method ?? '').toUpperCase()) && !isJsonRequest(req)) {
      sendText(res, 415, 'content type must be application/json')
      return
    }
    handler(req, res)
  }
}

export function registerRoutes(ctx: Context, config: () => Config): void {
  // DSH's connection service, read through the context that injected it (this plugin's own, or the host's
  // when another plugin mounts this one with its ctx). Once that service goes away the context is inactive
  // and reading it throws, so every route answers 503. It never falls open.
  let lookup: (() => unknown) | null = null
  ctx.inject(['connection'], (scoped) => {
    lookup = () => (scoped as unknown as { connection?: unknown }).connection
  })
  const connection = (): ConnectionGuard | null => {
    try {
      const service = lookup?.() as Partial<ConnectionGuard> | undefined
      return service && typeof service.requestRejection === 'function' ? service as ConnectionGuard : null
    } catch {
      return null
    }
  }

  ctx.inject(['webServer'], (scoped) => {
    const web = {
      register: (route: { kind: 'exact'; path: string; handler: Handler }) => scoped.webServer.register({ ...route, handler: guardRoute(connection, route.handler) }),
    }

    web.register({
      kind: 'exact',
      path: '/api/mirobody/status',
      handler: (_req, res) => {
        const current = config()
        const engine = runBridgeSync(
          discoverPython(current.pythonBin),
          current.mirobodyHome,
          { op: 'status' },
          current.timeoutMs,
        )
        sendJson(res, 200, {
          product: PRODUCT_NAME,
          version: PRODUCT_VERSION,
          tools: TOOL_NAMES,
          engine,
          mcp: {
            configured: Boolean(current.mcpUrl.trim()),
            host: mcpHost(current.mcpUrl),
            token_set: Boolean(current.mcpToken.trim()),
          },
        })
      },
    })
    web.register({
      kind: 'exact',
      path: '/api/mirobody/resolve',
      handler: (req, res) => {
        const names = queryNames(req.url)
        if (names.length === 0) {
          sendJson(res, 400, { ok: false, error: 'pass one or more q parameters' })
          return
        }
        const current = config()
        const result = runBridgeSync(
          discoverPython(current.pythonBin),
          current.mirobodyHome,
          { op: 'resolve', names },
          current.timeoutMs,
        )
        sendJson(res, result.ok ? 200 : 503, result)
      },
    })
    web.register({
      kind: 'exact',
      path: '/api/mirobody/version',
      handler: (_req, res) => sendJson(res, 200, { product: PRODUCT_NAME, version: PRODUCT_VERSION }),
    })
  })
}
