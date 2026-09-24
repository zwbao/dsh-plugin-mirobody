export const NAMESPACE = 'dsh-plugin-mirobody'
export const VIEW_ID = 'mirobody-dashboard'

export const SUGGESTED = [
  { id: 'loinc', zh: '血红蛋白、LDL cholesterol、空腹血糖分别是哪个 LOINC？' },
  { id: 'unit', zh: '总胆固醇 5.0 mmol/L 对应哪个码？换成 mg/dL 是多少？' },
  { id: 'panel', zh: '为什么“血脂”不能解析成一个化验项目？' },
  { id: 'record', zh: '如果已经接上我的 Mirobody，查最近血压的变化，每个数字都要带来源。' },
] as const
