import type { Context } from '@deepseek-ai/cordis'
import './host-shims.ts'
import { Config } from './config.ts'
import { registerCommands } from './commands.ts'
import { guardPreStep } from './guard.ts'
import { registerPrompt } from './prompt.ts'
import { registerRoutes } from './routes.ts'
import { registerSkills } from './skills.ts'
import { registerTools } from './tools.ts'
export const name = 'dsh-plugin-mirobody'
export const inject = ['tools']
export { Config }
export { preGuard, wrapGuardMessage, ruleLabels, guidanceNote, mentionsMedicine, personText, LABEL_KEYS, EMERGENCY_REPLY_ZH, NO_MEDICATION_CHANGE_ZH } from './guardrails.ts'
export type { GuardHit, GuardLabels, GuidanceNote } from './guardrails.ts'
export { guardPreStep, noteMessage } from './guard.ts'
export { PRODUCT_VERSION, TOOL_NAMES } from './version.ts'
export { validateGeneticQuery, validateHealthQuery, validateMedicationQuery } from './validate.ts'
export { discoverPython, runBridgeSync } from './engine.ts'
export { guardRoute, isJsonRequest, CONNECTION_UNAVAILABLE } from './routes.ts'
export type { ConnectionGuard } from './routes.ts'

export function apply(ctx: Context, config: Config): void {
  const configSource = () => config
  registerTools(ctx, configSource)
  registerSkills(ctx)
  registerPrompt(ctx)
  registerRoutes(ctx, configSource)
  registerCommands(ctx, configSource)

  // One guidance note after the person's words when the rules flag them; their message is never replaced.
  ctx.on('agent/pre-step', (payload, next) => guardPreStep(payload, next))
}
