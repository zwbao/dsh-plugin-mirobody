import type { Context } from '@deepseek-ai/cordis'
import './host-shims.ts'
import { Config } from './config.ts'
import { registerCommands } from './commands.ts'
import { extractUserText, preGuard, wrapGuardMessage } from './guardrails.ts'
import { registerPrompt } from './prompt.ts'
import { registerRoutes } from './routes.ts'
import { registerSkills } from './skills.ts'
import { registerTools } from './tools.ts'
export const name = 'dsh-plugin-mirobody'
export const inject = ['tools']
export { Config }
export { preGuard, wrapGuardMessage } from './guardrails.ts'
export { PRODUCT_VERSION, TOOL_NAMES } from './version.ts'
export { validateGeneticQuery, validateHealthQuery, validateMedicationQuery } from './validate.ts'
export { discoverPython, runBridgeSync } from './engine.ts'

export function apply(ctx: Context, config: Config): void {
  const configSource = () => config
  registerTools(ctx, configSource)
  registerSkills(ctx)
  registerPrompt(ctx)
  registerRoutes(ctx, configSource)
  registerCommands(ctx, configSource)

  ctx.on('agent/pre-step', async (payload, next) => {
    const text = payload.messages.map((message) => extractUserText(message.content)).join('\n')
    const hit = preGuard(text)
    if (!hit) return next()
    const first = payload.messages[0]
    if (!first) return { kind: 'reject' }
    return {
      kind: 'enter',
      messages: [{
        ...first,
        content: [{ type: 'text', text: wrapGuardMessage(text, hit) }],
      }],
    }
  })
}
