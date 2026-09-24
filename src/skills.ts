import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'

const SKILL_NAMES = ['terminology', 'readings', 'medications', 'genetics'] as const

function parseSkill(raw: string): { name: string; description: string; content: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!match) throw new Error('SKILL.md missing frontmatter')
  const fm = match[1] ?? ''
  const content = (match[2] ?? '').trim()
  const name = fm.match(/^name:\s*(.+)$/m)?.[1]?.trim()
  const description = fm.match(/^description:\s*(.+)$/m)?.[1]?.trim()
  if (!name || !description) throw new Error('SKILL.md missing name/description')
  return { name, description, content }
}

export function registerSkills(ctx: Context): void {
  ctx.inject(['skills'], (scoped) => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills')
    for (const dir of SKILL_NAMES) {
      const raw = readFileSync(join(root, dir, 'SKILL.md'), 'utf8')
      const skill = parseSkill(raw)
      scoped.skills.register({
        name: skill.name,
        description: skill.description,
        content: skill.content,
        source: 'runtime',
        invocation: { modelInvocable: true, userInvocable: false },
      })
    }
  })
}
