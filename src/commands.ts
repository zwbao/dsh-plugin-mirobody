import type { Context } from '@deepseek-ai/cordis'
import type { Config } from './config.ts'
import { discoverPython, runBridgeSync } from './engine.ts'
import { mcpHost } from './mcp.ts'
import { PRODUCT_NAME, PRODUCT_VERSION } from './version.ts'

interface CommandsLike {
  register(definition: {
    name: string
    description: string
    handler: (invocation: { rawInput: string }) => { kind: 'success' | 'error'; text?: string }
  }): unknown
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    commands: CommandsLike
  }
}

function argsOf(raw: string, name: string): string {
  const text = raw.trim().replace(/^\//, '')
  if (text === name) return ''
  if (text.startsWith(`${name} `)) return text.slice(name.length).trim()
  return text
}

export function registerCommands(ctx: Context, config: () => Config): void {
  ctx.inject(['commands'], (scoped) => {
    scoped.commands.register({
      name: 'mirobody',
      description: '打印 Mirobody 引擎是否可导入，以及记录服务器是否已配置（不含 token）。',
      handler: () => {
        const current = config()
        const status = runBridgeSync(
          discoverPython(current.pythonBin),
          current.mirobodyHome,
          { op: 'status' },
          current.timeoutMs,
        )
        const lines = [
          `${PRODUCT_NAME} ${PRODUCT_VERSION}`,
          status.ok
            ? `engine ${status.version ?? 'unknown'}  bundle ${status.bundle ?? 'unknown'}  python ${status.python ?? ''}`
            : `engine unavailable: ${status.error ?? 'unknown'}`,
          current.mcpUrl.trim()
            ? `mcp host ${mcpHost(current.mcpUrl) || '(unparsed)'}  token ${current.mcpToken.trim() ? 'set' : 'empty'}`
            : 'mcp not configured — record tools need mcpUrl',
        ]
        return { kind: status.ok ? 'success' : 'error', text: lines.join('\n') }
      },
    })
    scoped.commands.register({
      name: 'mirobody-resolve',
      description: '用离线引擎解析一个或多个指标名。例：/mirobody-resolve 血红蛋白 血脂',
      handler: (invocation) => {
        const names = argsOf(invocation.rawInput, 'mirobody-resolve').split(/\s+/).filter(Boolean).slice(0, 20)
        if (names.length === 0) return { kind: 'error', text: '用法：/mirobody-resolve 血红蛋白 LDL' }
        const current = config()
        const result = runBridgeSync(
          discoverPython(current.pythonBin),
          current.mirobodyHome,
          { op: 'resolve', names },
          current.timeoutMs,
        )
        return { kind: result.ok ? 'success' : 'error', text: JSON.stringify(result, null, 2) }
      },
    })
    scoped.commands.register({
      name: 'mirobody-version',
      description: '打印 dsh-plugin-mirobody 版本。',
      handler: () => ({ kind: 'success', text: `${PRODUCT_NAME} ${PRODUCT_VERSION}` }),
    })
  })
}
