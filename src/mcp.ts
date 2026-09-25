import { PRODUCT_NAME, PRODUCT_VERSION } from './version.ts'

export interface McpCallResult {
  success?: boolean
  error_kind?: string
  error?: string
  hint?: string
  code?: number
  result?: unknown
  text?: string
}

function endpoint(raw: string): URL | null {
  try {
    const url = new URL(raw.trim())
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url
  } catch {
    return null
  }
}

export function mcpHost(raw: string): string {
  const url = endpoint(raw)
  return url ? url.host : ''
}

function parseBody(text: string): unknown {
  const trimmed = text.trim()
  if (!trimmed) throw new Error('empty MCP response')
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return JSON.parse(trimmed)
  const payloads: string[] = []
  for (const line of trimmed.split('\n')) {
    if (!line.startsWith('data:')) continue
    const payload = line.slice(5).trim()
    if (payload && payload !== '[DONE]') payloads.push(payload)
  }
  if (payloads.length === 0) throw new Error('MCP response had no JSON or SSE data')
  return JSON.parse(payloads[payloads.length - 1] ?? '')
}

function unwrap(message: unknown): McpCallResult {
  if (!message || typeof message !== 'object') {
    return { success: false, error_kind: 'internal', error: 'MCP response was not an object' }
  }
  const body = message as {
    error?: { code?: number; message?: string }
    result?: { content?: Array<{ type?: string; text?: string }>; structuredContent?: unknown }
  }
  if (body.error) {
    const denied = body.error.code === -32000 || /auth/i.test(body.error.message ?? '')
    return {
      success: false,
      error_kind: denied ? 'denied' : 'internal',
      error: body.error.message || 'MCP error',
      code: body.error.code,
      hint: denied
        ? 'Mirobody refused this call. Set mcpToken to the account JWT, or paste the personal MCP URL from Settings → MCP.'
        : 'The Mirobody MCP server returned an error. Do not invent the missing record.',
    }
  }
  const structured = body.result?.structuredContent
  if (structured !== undefined) return { success: true, result: structured }
  const content = body.result?.content
  if (Array.isArray(content)) {
    const text = content.filter((block) => block.type === 'text').map((block) => block.text ?? '').join('\n')
    if (!text) return { success: true, result: body.result }
    try {
      return { success: true, result: JSON.parse(text) as unknown }
    } catch {
      return { success: true, text }
    }
  }
  return { success: true, result: body.result ?? message }
}

async function postJson(
  url: string,
  token: string,
  body: unknown,
  session: string,
  timeoutMs: number,
): Promise<{ status: number; session: string; text: string }> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    'mcp-protocol-version': '2025-06-18',
  }
  if (token.trim()) headers.authorization = `Bearer ${token.trim()}`
  if (session) headers['mcp-session-id'] = session
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const nextSession = response.headers.get('mcp-session-id') ?? session
  return { status: response.status, session: nextSession, text: await response.text() }
}

export async function callMcpTool(options: {
  url: string
  token: string
  name: string
  args: Record<string, unknown>
  timeoutMs: number
}): Promise<McpCallResult> {
  const target = endpoint(options.url)
  if (!target) {
    return {
      success: false,
      error_kind: 'unavailable',
      error: 'mcpUrl is empty or not http(s)',
      hint: 'Run Mirobody (`./deploy.sh`, default http://127.0.0.1:18060/mcp) and set mcpUrl. Record tools do not read a database inside DSH.',
    }
  }
  const url = target.toString()
  try {
    const init = await postJson(url, options.token, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: PRODUCT_NAME, version: PRODUCT_VERSION },
      },
    }, '', options.timeoutMs)
    if (init.status === 401 || init.status === 403) {
      return {
        success: false,
        error_kind: 'denied',
        error: `MCP HTTP ${init.status}`,
        hint: 'Set mcpToken to a Mirobody JWT, or use the personal MCP URL from Settings → MCP. Terminology tools do not need this.',
      }
    }
    let session = init.session
    if (session) {
      await postJson(url, options.token, {
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      }, session, options.timeoutMs).catch(() => undefined)
    }
    const call = await postJson(url, options.token, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: options.name, arguments: options.args },
    }, session, options.timeoutMs)
    if (call.status === 401 || call.status === 403) {
      return {
        success: false,
        error_kind: 'denied',
        error: `MCP HTTP ${call.status}`,
        hint: 'The Mirobody account token was rejected.',
      }
    }
    return unwrap(parseBody(call.text))
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError'
    return {
      success: false,
      error_kind: timedOut ? 'unavailable' : 'internal',
      error: error instanceof Error ? error.message : 'MCP call failed',
      hint: timedOut
        ? 'The Mirobody server did not answer before timeoutMs.'
        : 'Could not reach mcpUrl. Confirm the server is up. Do not fill the gap with guessed labs.',
    }
  }
}
