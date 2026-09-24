import type { Context } from '@deepseek-ai/cordis'
import '../host-shims.ts'
import { registerDock, registerPanel, registerSidebar } from './panel.ts'
import { injectStyles } from './styles.ts'

export const inject = ['slots']

export function apply(ctx: Context): void {
  injectStyles()
  registerPanel(ctx)
  registerSidebar(ctx)
  registerDock(ctx)
}
