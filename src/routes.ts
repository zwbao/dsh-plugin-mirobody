import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { Config } from './config.ts'
import { discoverPython, runBridgeSync } from './engine.ts'
import { mcpHost } from './mcp.ts'
import { PRODUCT_NAME, PRODUCT_VERSION, TOOL_NAMES } from './version.ts'

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(text)
}

function queryNames(url: string | undefined): string[] {
  if (!url) return []
  const parsed = new URL(url, 'http://127.0.0.1')
  return parsed.searchParams.getAll('q').map((item) => item.trim()).filter(Boolean).slice(0, 20)
}

export function registerRoutes(ctx: Context, config: () => Config): void {
  ctx.inject(['webServer'], (scoped) => {
    scoped.webServer.register({
      kind: 'exact',
      path: '/api/mirobody/status',
      handler: (_req: IncomingMessage, res: ServerResponse) => {
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
    scoped.webServer.register({
      kind: 'exact',
      path: '/api/mirobody/resolve',
      handler: (req: IncomingMessage, res: ServerResponse) => {
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
    scoped.webServer.register({
      kind: 'exact',
      path: '/api/mirobody/version',
      handler: (_req, res) => sendJson(res, 200, { product: PRODUCT_NAME, version: PRODUCT_VERSION }),
    })
  })
}
