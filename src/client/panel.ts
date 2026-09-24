import React from 'react'
import { SUGGESTED, VIEW_ID } from './constants.ts'

interface EngineStatus {
  ok?: boolean
  version?: string
  bundle?: string
  python?: string
  error?: string
}

interface StatusPayload {
  version?: string
  tools?: string[]
  engine?: EngineStatus
  mcp?: { configured?: boolean; host?: string; token_set?: boolean }
}

interface ResolveRow {
  name?: string
  resolved?: boolean
  loinc?: string
  canonical?: string
}

function api(path: string): string {
  const token = new URLSearchParams(window.location.search).get('token')
  if (!token) return path
  const join = path.includes('?') ? '&' : '?'
  return `${path}${join}token=${encodeURIComponent(token)}`
}

export function registerPanel(ctx: {
  slots: {
    inject: (name: string, factory: () => unknown) => unknown
    register: (options: Record<string, unknown>, component: unknown) => unknown
  }
}): void {
  ctx.slots.inject('conversation.view', () => ctx.slots.register(
    {
      name: 'conversation.view',
      id: VIEW_ID,
      order: 22,
      label: () => 'Mirobody',
    },
    PanelView,
  ))
}

function PanelView(): React.ReactElement {
  const [status, setStatus] = React.useState<StatusPayload | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [query, setQuery] = React.useState('血红蛋白 血脂')
  const [rows, setRows] = React.useState<ResolveRow[] | null>(null)
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    fetch(api('/api/mirobody/status'), { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json() as Promise<StatusPayload>
      })
      .then((json) => {
        if (!cancelled) setStatus(json)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'status failed')
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function resolveNames(): Promise<void> {
    const names = query.split(/\s+/).map((item) => item.trim()).filter(Boolean).slice(0, 20)
    if (names.length === 0) return
    setBusy(true)
    setRows(null)
    try {
      const params = names.map((name) => `q=${encodeURIComponent(name)}`).join('&')
      const res = await fetch(api(`/api/mirobody/resolve?${params}`), { credentials: 'include' })
      const json = await res.json() as { results?: ResolveRow[]; error?: string }
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
      setRows(Array.isArray(json.results) ? json.results : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'resolve failed')
    } finally {
      setBusy(false)
    }
  }

  const engine = status?.engine
  const engineLine = engine?.ok
    ? `${engine.version || 'mirobody'} · ${engine.python || ''}`
    : (engine?.error || error || '引擎未就绪')

  return React.createElement(
    'div',
    { className: 'mb-dash' },
    React.createElement('div', { className: 'mb-kicker' }, `Mirobody ${status?.version ?? ''}`),
    React.createElement('h2', { className: 'mb-title' }, '一郎记录，一个标准'),
    React.createElement(
      'p',
      { className: 'mb-lead' },
      '指标名在本机解析成 LOINC，单位收成 UCUM。病历、用药和基因型只从你自己的 Mirobody 服务器读取，插件不另存一份。',
    ),
    React.createElement(
      'div',
      { className: 'mb-grid' },
      React.createElement(
        'section',
        { className: 'mb-card' },
        React.createElement('h3', null, '离线引擎'),
        React.createElement('p', { className: engine?.ok ? 'mb-ok' : 'mb-bad' }, engineLine),
        engine?.bundle
          ? React.createElement('p', null, engine.bundle)
          : null,
      ),
      React.createElement(
        'section',
        { className: 'mb-card' },
        React.createElement('h3', null, '记录服务器'),
        React.createElement(
          'p',
          null,
          status?.mcp?.configured
            ? `${status.mcp.host || '已配置'} · token ${status.mcp.token_set ? '已设置' : '未设置'}`
            : '未配置 mcpUrl。术语工具不需要它。',
        ),
      ),
      React.createElement(
        'section',
        { className: 'mb-card' },
        React.createElement('h3', null, '工具'),
        React.createElement('p', null, `${status?.tools?.length ?? 8} 个：术语 4，记录 3，状态 1`),
      ),
    ),
    React.createElement(
      'form',
      {
        className: 'mb-form',
        onSubmit: (event: React.FormEvent) => {
          event.preventDefault()
          void resolveNames()
        },
      },
      React.createElement('input', {
        value: query,
        'aria-label': '指标名',
        onChange: (event: React.ChangeEvent<HTMLInputElement>) => setQuery(event.target.value),
      }),
      React.createElement('button', { type: 'submit', disabled: busy }, busy ? '解析中' : '解析'),
    ),
    ...(rows ?? []).map((row) => React.createElement(
      'div',
      { className: 'mb-row', key: row.name },
      React.createElement('span', null, row.name),
      React.createElement(
        'span',
        { className: 'mb-code' },
        row.resolved ? `${row.loinc || ''} ${row.canonical || ''}`.trim() : '未解析',
      ),
    )),
    React.createElement(
      'p',
      { className: 'mb-note' },
      '未解析是诚实的空，不是漏码。这不是诊断，也不能改处方。紧急情况请拨打 120。',
    ),
  )
}

export function registerDock(ctx: {
  slots: {
    inject: (name: string, factory: () => unknown) => unknown
    register: (options: Record<string, unknown>, component: unknown) => unknown
  }
}): void {
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register(
    { name: 'conversation.input.dock', id: 'dsh-plugin-mirobody', order: 25 },
    SuggestDock,
  ))
}

function SuggestDock(): React.ReactElement {
  const [copied, setCopied] = React.useState<string | null>(null)
  return React.createElement(
    'div',
    { className: 'mb-dock' },
    React.createElement('span', { className: 'mb-dock-kicker' }, 'Mirobody'),
    ...SUGGESTED.map((item) => React.createElement('button', {
      key: item.id,
      type: 'button',
      className: copied === item.id ? 'mb-dock-chip mb-dock-chip-on' : 'mb-dock-chip',
      onClick: () => {
        void navigator.clipboard.writeText(item.zh).then(() => setCopied(item.id)).catch(() => setCopied(item.id))
      },
    }, item.zh)),
  )
}

export function registerSidebar(ctx: {
  slots: {
    inject: (name: string, factory: () => unknown) => unknown
    register: (options: Record<string, unknown>, component: unknown) => unknown
  }
}): void {
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register(
    { name: 'sidebar.footer.action', id: 'dsh-plugin-mirobody', order: 40 },
    SidebarMark,
  ))
}

function SidebarMark(props: { wide?: boolean }): React.ReactElement {
  return React.createElement(
    'span',
    { className: 'mb-sidebar', title: 'Mirobody' },
    React.createElement('span', { className: 'mb-dot' }),
    props.wide === false ? null : React.createElement('span', null, 'Mirobody'),
  )
}
