export type GuardHit =
  | { code: 'emergency'; reply_zh: string }
  | { code: 'no_medication_change'; reply_zh: string }

const EMERGENCY = [
  '胸痛',
  '胸口疼',
  '呼吸困难',
  '喘不上气',
  '晕倒',
  '昏迷',
  '抽搐',
  '大出血',
  '自杀',
  '不想活',
  '严重过敏',
  '中风',
  '半身麻木',
  'chest pain',
  "can't breathe",
  'fainted',
  'seizure',
  'suicide',
  'overdose',
  'stroke',
]

const DOSE_CHANGE = /(停药|把药停|停掉.{0,4}药|加量|减量|换药|改剂量|调整剂量|increase (the |my )?dose|stop (my |the )?(medication|medicine|drug)|change (my |the )?dose)/i

export function preGuard(text: string): GuardHit | null {
  const lower = text.toLowerCase()
  if (EMERGENCY.some((k) => lower.includes(k.toLowerCase()))) {
    return {
      code: 'emergency',
      reply_zh: '如果您正在经历紧急不适，请立即拨打 120 或当地急救电话。在美国可拨打或发短信至 988。我不能替代急救，也不会给出处理步骤。',
    }
  }
  if (DOSE_CHANGE.test(text)) {
    return {
      code: 'no_medication_change',
      reply_zh: '我不能建议开始、停止、加量、减量或更换药物。用药记录只读。调整处方请联系开具该药的医生。',
    }
  }
  return null
}

export function extractUserText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((block) => {
      if (block && typeof block === 'object' && 'type' in block && (block as { type: string }).type === 'text') {
        return String((block as { text?: string }).text ?? '')
      }
      return ''
    })
    .join('\n')
}

export function wrapGuardMessage(text: string, hit: GuardHit): string {
  return [
    hit.reply_zh,
    '',
    'Answer with that boundary only. Do not add a diagnosis, a dose, or a treatment step.',
    `The user said: ${text.slice(0, 500)}`,
  ].join('\n')
}
