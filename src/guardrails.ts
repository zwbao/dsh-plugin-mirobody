// The guard's rules and its guidance notes. The rules are narrow and clause-aware (ported from
// dsh-plugin-longpi's rule layer): a symptom that is negated, a family member's history, a past event
// or a question about risk is not an emergency; 山药 is not a medicine; a record of what someone
// already did is not a request. A hit never replaces or drops the person's words: the plugin appends
// one note for the model after them (guidanceNote, index.ts).

export const LABEL_KEYS = ['acute_emergency', 'self_harm', 'med_change_request'] as const
export type LabelKey = typeof LABEL_KEYS[number]
export type GuardLabels = Record<LabelKey, boolean> & { reason: string }

export function noLabels(reason = ''): GuardLabels {
  return { acute_emergency: false, self_harm: false, med_change_request: false, reason }
}

// ---------------------------------------------------------------- text helpers

/** Clauses: negation, family and history words count only inside their own clause. */
function clauses(text: string): string[] {
  return text
    .split(/[。！!？?；;\n\r，,、：:]+|\.(?=\s|$)|\s+(?:but|however|although)\s+|但是|但|可是|然而/i)
    .map((part) => part.trim())
    .filter(Boolean)
}

/** Sentences, keeping the question mark: 「阿司匹林，可以停吗」 is one request. */
function sentences(text: string): string[] {
  return text
    .split(/(?<=[。！!？?；;\n\r])|(?<=\.)\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
}

const CJK = /[㐀-鿿]/

// A negation just before a Chinese term (无胸痛, 否认胸痛, 没有心梗), or anywhere before an English one in the clause.
const NEG_ZH = /[无没否未不非]/
const NEG_ZH_KEEP = /不停|不断|不住|不了|不知道|不清楚|不舒服|不对劲|受不了/g
const NEG_EN = /\b(?:no|not|without|never|denies|denied|deny|don'?t|do not|didn'?t|did not|haven'?t|have not|hasn'?t|isn'?t|wasn'?t|none|free of)\b/i

function negatedBefore(clause: string, index: number): boolean {
  const before = clause.slice(0, index)
  if (CJK.test(clause[index] ?? '')) return NEG_ZH.test(before.replace(NEG_ZH_KEEP, '').slice(-4))
  return NEG_EN.test(before)
}

// Someone else: a family member (their history is not the speaker's emergency).
const FAMILY = /父母|父亲|母亲|爸|妈|爷爷|奶奶|外公|外婆|姥姥|姥爷|祖父|祖母|兄弟|姐妹|哥哥|姐姐|弟弟|妹妹|叔叔|伯伯|姑姑|舅舅|阿姨|儿子|女儿|孩子|老公|老婆|丈夫|妻子|亲属|亲戚|家人|家里人|家族|家属|全家|家父|\b(?:family|father|mother|dad|mom|mum|parents?|brother|sister|grand(?:father|mother|pa|ma)|uncle|aunt|relatives?|husband|wife|son|daughter)\b/i
// History, risk, a report line: not happening now.
const HISTORY = /风险|几率|概率|可能性|预防|降低|避免|史|既往|以前|之前|曾经|去年|前年|上个?月|上周|小时候|年轻时|年前|多年前|得过|患过|有过|犯过|发生过|去世|过世|体检|报告|化验|检查结果|心电图|会不会|算的是|指的是|\b(?:risk|history|historical|chance|probability|prevent\w*|reduce|lower|avoid|used to|(?:years?|months?|weeks?|days?) ago|last (?:year|month|week)|in the past|previously|score)\b/i
// A general question, unless the speaker says it is happening to them now.
const GENERIC = /是什么|什么原因|原因是|怎么回事|定义|症状有哪些|有哪些症状|\b(?:what (?:is|are|causes)|symptoms of)\b/i
const NOW = /现在|正在|突然|刚才|刚刚|此刻|\bright now\b|\bjust now\b|\bi(?:'m| am)\b/i
// Right after the term: a past event or a symptom that is gone.
const AFTER = /^(?:过|史)|^[^，,。]{0,4}(?:不明显|已经?(?:好|缓解|消失)|好了|缓解了|消失了|没了)/

// ---------------------------------------------------------------- emergency and self-harm

// Global: used with matchAll only.
const ACUTE = new RegExp([
  '胸痛', '胸口(?:剧烈)?(?:剧)?(?:痛|疼)', '心口(?:痛|疼)', '胸(?:口)?(?:压榨|压迫)(?:感|样)?', '胸闷得(?:厉害|要命|不行)', '胸闷[^，,。]{0,4}(?:出冷汗|喘不)',
  '呼吸困难', '喘不(?:上|过)(?:气|来)', '上不来气', '透不过气', '无法呼吸', '不能呼吸',
  '晕倒', '晕厥', '昏迷', '昏过去', '叫不醒', '意识不清', '不省人事', '抽搐', '大出血', '吐血', '咯血',
  '严重过敏', '过敏性休克', '喉咙[^，,。]{0,2}肿',
  '口角歪斜', '嘴(?:巴)?歪', '半身(?:麻木|不遂|无力)', '一侧(?:身体|手脚|肢体|手|腿|脸)?[^，,。]{0,2}(?:没力气|无力|麻木|不能动)',
  '说话不清', '口齿不清', '说不出话', '突然看不见',
  '(?:心梗|心肌梗死|心肌梗塞|中风|脑梗|脑卒中|卒中|脑出血)(?:了|发作|犯了)',
  'chest pain', 'chest (?:is )?(?:tight|pressure|hurts?)', "can(?:no|')?t breathe", 'can not breathe', 'unable to breathe', 'short of breath', 'trouble breathing', 'struggling to breathe',
  'fainted', 'passed out', 'unconscious', 'not breathing', 'seizure', 'convulsing', 'coughing (?:up )?blood', 'vomiting blood', 'bleeding heavily', 'heavy bleeding',
  'anaphyla', 'throat (?:is )?(?:closing|swelling)', 'face (?:is )?drooping', 'slurred speech', '(?:numb|weak) on one side', 'one side of my (?:body|face)',
  "(?:i am|i'm|i think i'm|i think i am|i might be|i may be) having a (?:heart attack|stroke)",
].join('|'), 'gi')

// A person with the speaker now: only the signs no one mistakes for history,
// or a sudden sign described as happening now (我妈突然说话不清楚).
const BYSTANDER_NOW = /(?:突然|现在|正在|刚才|刚刚)[^，,。]{0,6}(?:说话不清|口齿不清|说不出话|嘴(?:巴)?歪|口角歪斜|一侧|半身|胸口|胸痛|喘不|呼吸困难|抽搐|晕倒|昏迷)/
const BYSTANDER = /叫不醒|没有?呼吸了?|不呼吸了|没反应了?|没有反应|不省人事|昏迷|晕倒了|倒下了|抽搐|口吐白沫|\b(?:unconscious|not breathing|unresponsive|collapsed|won'?t wake up|having a seizure|having a (?:heart attack|stroke))\b/i

// Global: used with matchAll only.
const SELF_HARM = new RegExp([
  '自杀', '轻生', '割腕', '跳楼', '寻死', '不想活(?!到|过|成|得)', '(?<![不别怕])想死(?![你您他她它得的地])', '活着没(?:意思|意义)', '活不下去',
  '结束(?:自己的?)?生命', '伤害自己', '了结自己', '一死了之', '死了算了',
  'suicid', 'kill myself', 'end(?:ing)? my life', 'end(?:ing)? it all', 'want to die', 'wanna die', "don'?t want to (?:live|be alive)", 'hurt myself', 'self[- ]harm', 'better off dead',
].join('|'), 'gi')
const SELF_HARM_CONTEXT = /风险|研究|论文|统计|数据|评估|预防|以前|曾经|过去|\b(?:risk|stud(?:y|ies)|rates?|prevent\w*|research|used to|in the past)\b/i

function acuteIn(clause: string): boolean {
  const lower = clause.toLowerCase()
  if (HISTORY.test(lower)) return false
  if (GENERIC.test(lower) && !NOW.test(lower)) return false
  if (FAMILY.test(lower)) {
    const hit = BYSTANDER.exec(lower) ?? BYSTANDER_NOW.exec(lower)
    return !!hit && !negatedBefore(lower, hit.index) && !AFTER.test(lower.slice(hit.index + hit[0].length))
  }
  for (const hit of lower.matchAll(ACUTE)) {
    const index = hit.index ?? 0
    if (negatedBefore(lower, index)) continue
    if (AFTER.test(lower.slice(index + hit[0].length))) continue
    return true
  }
  return false
}

function selfHarmIn(clause: string): boolean {
  const lower = clause.toLowerCase()
  if (FAMILY.test(lower) || SELF_HARM_CONTEXT.test(lower)) return false
  for (const hit of lower.matchAll(SELF_HARM)) {
    // 「不想活」 carries its own 不; only a negation before it counts.
    if (negatedBefore(lower, hit.index ?? 0)) continue
    return true
  }
  return false
}

// ---------------------------------------------------------------- medicines

// Named drugs and supplements.
const DRUGS = [
  '二甲双胍', '阿司匹林', '雷帕霉素', '西罗莫司', '他汀', '阿托伐他汀', '瑞舒伐他汀', '辛伐他汀', '降压药', '降糖药', '降脂药',
  '胰岛素', '司美格鲁肽', '替尔泊肽', '利拉鲁肽', '阿卡波糖', '达格列净', '恩格列净', '华法林', '氯吡格雷', '左甲状腺素',
  '优甲乐', '激素', '泼尼松', '地塞米松', '褪黑素', '安眠药', '抗抑郁药', '达沙替尼', '槲皮素', '非瑟酮', '白藜芦醇',
  '氨氯地平', '硝苯地平', '缬沙坦', '氯沙坦', '厄贝沙坦', '美托洛尔', '比索洛尔', '依那普利', '氢氯噻嗪', '格列美脲', '西格列汀',
  '布洛芬', '对乙酰氨基酚', '奥美拉唑', '叶酸', '钙片', '益生菌', '姜黄素', '睾酮', '雌激素',
  'nmn', 'nr', '烟酰胺核糖', '烟酰胺单核苷酸', '亚精胺', '尿石素', '辅酶q10', '维生素d', '维生素', '鱼油', '补剂', '保健品',
  'metformin', 'aspirin', 'rapamycin', 'sirolimus', 'statins?', 'atorvastatin', 'rosuvastatin', 'insulin', 'semaglutide',
  'tirzepatide', 'acarbose', 'warfarin', 'clopidogrel', 'levothyroxine', 'prednisone', 'melatonin', 'dasatinib', 'amlodipine',
  'quercetin', 'fisetin', 'resveratrol', 'spermidine', 'urolithin', 'coq10', 'vitamin d', 'fish oil', 'omega-3', 'ozempic',
]
// Chinese generic-name endings: 氨氯地平, 缬沙坦, 美托洛尔, 瑞舒伐他汀…
const DRUG_SUFFIX = /地平|沙坦|普利|洛尔|他汀|双胍|格列|列净|列汀|鲁肽|泊肽|替尼|霉素|西林|沙星|拉唑|噻嗪|匹林|洛芬|西泮|唑仑|曲坦|莫司|替丁|司琼|膦酸|肝素|格雷/
// 药 that is not a medicine.
const NOT_MEDICINE = /淮?山药|芍药|药膳|药食同源|药用价值|农药|火药|炸药|弹药|药材/g
const MEDICINE_WORD = /药|处方|补剂|补充剂|保健品|营养素|维生素|维他命|\b(?:medications?|medicines?|meds|drugs?|pills?|tablets?|capsules?|supplements?|prescriptions?|vitamins?)\b/i

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function nameHit(lower: string, name: string): boolean {
  const item = name.toLowerCase()
  if (!item) return false
  if (/^[a-z0-9 ?-]+$/.test(item)) return new RegExp(`(?<![a-z0-9])${item.includes('?') ? item : escapeRegExp(item)}(?![a-z0-9])`, 'i').test(lower)
  return lower.includes(item)
}

/** Whether the text names a medicine or supplement: a generic word (not 山药), a known name, or a drug-name ending. */
export function mentionsMedicine(text: string): boolean {
  const lower = String(text ?? '').normalize('NFKC').toLowerCase().replace(NOT_MEDICINE, ' ')
  if (MEDICINE_WORD.test(lower) || DRUG_SUFFIX.test(lower)) return true
  return DRUGS.some((name) => nameHit(lower, name))
}

// Asking whether to change: an ask word right before the verb (可以停, 要不要把…停了, 还要继续吃).
const ASK_CHANGE = /(?:可以|能|能不能|能否|要不要|该不该|应不应该|应该|需不需要|需要|可不可以|是否|用不用|还用|还要|还能|必须)(?:继续|再|先|马上|直接|自己|也)?(?:把[^，,。？?！!]{1,12})?(?:停|断|不吃|别吃|吃|服|换|加量|减量|加|减|调整|补|开始)/
// …or the verb and then the question: 停掉可以吗, 不吃了行不行.
const CHANGE_ASKED = /(?:停掉|停用|停止|停了|停|不吃了?|别吃|换掉|减量|加量|减半)(?:的话)?(?:(?:可以|行|好|合适|没问题)?(?:吗|嘛|么|？|\?)|行不行|好不好|可不可以|可以不)/
// An intent or a request to change, unless it is about recording, uploading or reading.
const INTENT_CHANGE = /(?:我想|我要|我打算|我准备|我决定|我考虑|想要|打算|准备|决定|考虑|帮我|给我|请你|请帮我?|麻烦你?)(?!到|记录|记一下|记下|保存|存下|存一下|打卡|上传|录入|整理|看|查|分析|解读|算|知道|了解|问|找|读|讲|说|介绍|解释)[^，,。？?！!]{0,12}?(?:停|断|不吃|别吃|开始吃|开始服|开始用|开始打|吃|服|用上|加上|加用|换|改|加量|减量|减|加|开|补|试)/
// Imperatives: 停掉阿司匹林, 把阿司匹林停掉, 阿司匹林停掉吧.
const IMPERATIVE = /^(?:请|麻烦)?(?:帮我|给我)?(?:停掉|停用|停止|停|断掉|戒掉|换掉|减掉|开始吃|开始服用|加用|别吃)|把[^，,。？?！!]{1,15}?(?:停掉|停止|停用|换掉|换成|减掉|减量|加量|减半|加倍|停了?吧|不吃了?吧)|(?:停掉|停了|不吃了|换了|减了|停)吧/
// A prescription: 给我开点二甲双胍, 能不能开点药 (not 医生给我开了).
const PRESCRIBE = /(?:给我|帮我|能不能|能否|可以|可不可以|请|麻烦你?)[^，,。？?！!]{0,4}开(?!了|的|过|始|心|车|会|门|玩笑)|开(?:点|些|一些|一点)(?!了)/
const PRESCRIBE_RECORD = /(?:医生|大夫|医院)[^，,。]{0,4}开(?:了|的|过)/
// The same record phrase, cut out before the change patterns run: 「医生给我开了二甲双胍」 is not 「给我开…」.
const PRESCRIBE_RECORD_ALL = new RegExp(PRESCRIBE_RECORD.source, 'g')
const EN_CHANGE = [
  /\b(?:can|could|may|should|shall) i (?:still )?(?:take|stop|start|quit|skip|continue|double|increase|decrease|reduce|come off|go off|switch)\b/i,
  /\b(?:want|going|plan(?:ning)?|need|trying|like|decided) to (?:stop|start|quit|come off|get off|take|switch|increase|decrease|reduce)\b/i,
  /^(?:please )?(?:stop|start|prescribe|switch|increase|decrease|reduce)\b/i,
  /\b(?:ok|okay|safe|fine|alright) (?:for me )?to (?:stop|start|quit|skip|take|come off)\b/i,
  /\bprescribe (?:me|something)\b|\bgive me (?:a |some )?(?:prescription|medication|meds|pills)\b/i,
  /\b(?:stop|quit|come off|get off) (?:taking )?(?:my |the )?\w/i,
]

function medChangeIn(sentence: string): boolean {
  const lower = sentence.toLowerCase()
  if (CJK.test(lower)) {
    const asked = lower.replace(PRESCRIBE_RECORD_ALL, '，')
    return ASK_CHANGE.test(asked) || CHANGE_ASKED.test(asked) || INTENT_CHANGE.test(asked) || IMPERATIVE.test(asked) || (PRESCRIBE.test(asked) && !PRESCRIBE_RECORD.test(lower))
  }
  // 「how much should I take」 asks for a dose, not for a change.
  const howMuch = /\bhow (?:much|many|often)\b/.test(lower)
  return EN_CHANGE.some((pattern, index) => !(index === 0 && howMuch) && pattern.test(lower))
}

/**
 * Labels from the rules. An emergency needs an acute sign that is not negated, not a family member's
 * history, not past and not a risk question; self-harm needs real intent (not 我不想死, not
 * 不想活到120岁); a medicine request needs a medicine (not 山药) and a request to start, stop or change it
 * (not a record of what the person already did).
 */
export function ruleLabels(input: string): GuardLabels {
  // NFKC, and typographic apostrophes (phone keyboards) folded so 「can’t breathe」 reads as 「can't breathe」.
  const text = String(input ?? '').normalize('NFKC').replace(/[‘’ʼ′]/g, "'").slice(0, 4000)
  const labels = noLabels()
  if (!text.trim()) return labels
  const parts = clauses(text)
  labels.acute_emergency = parts.some(acuteIn)
  labels.self_harm = parts.some(selfHarmIn)
  labels.med_change_request = mentionsMedicine(text) && sentences(text).some(medChangeIn)
  const hits = LABEL_KEYS.filter((key) => labels[key])
  labels.reason = hits.length > 0 ? `rules: ${hits.join(', ')}` : ''
  return labels
}

// ---------------------------------------------------------------- guidance notes

export const EMERGENCY_REPLY_ZH = '如果您正在经历紧急不适，请立即拨打 120 或当地急救电话。在美国可拨打或发短信至 988。我不能替代急救，也不会给出处理步骤。'
export const NO_MEDICATION_CHANGE_ZH = '我不能建议开始、停止、加量、减量或更换药物。用药记录只读。调整处方请联系开具该药的医生。'

export interface GuidanceNote {
  /** Model-facing text of the note. */
  text: string
  /** One line for the transcript row. */
  summary: string
}

const NOTE_HEAD = '[Mirobody safety note: added by the plugin, not written by the person. Follow it; never quote it as their words.]'

/** The one note appended after the person's words for what was flagged, or null. Emergencies and self-harm come first. */
export function guidanceNote(labels: GuardLabels): GuidanceNote | null {
  const why = labels.reason ? ` (${labels.reason.slice(0, 120)})` : ''
  if (labels.acute_emergency || labels.self_harm) {
    return {
      summary: 'Mirobody 安全提示：可能是紧急情况，先提醒拨打 120',
      text: [
        NOTE_HEAD,
        labels.acute_emergency
          ? `The message above may describe emergency symptoms happening now${why}.`
          : `The message above may mean the person is thinking about harming themselves${why}.`,
        `Begin your reply with this, in their language: 「${EMERGENCY_REPLY_ZH}」`,
        'Stay kind and short. Call no record tools. Give no diagnosis, no dose and no treatment steps. If it is unclear whether it is happening now, still say this first, then ask.',
      ].join('\n'),
    }
  }
  if (labels.med_change_request) {
    return {
      summary: 'Mirobody 安全提示：涉及用药调整，不给建议',
      text: [
        NOTE_HEAD,
        `The message above asks to start, stop or change a medicine or its dose${why}.`,
        `Say this, in their language: 「${NO_MEDICATION_CHANGE_ZH}」`,
        'Do not advise it either way and give no dose. Reading their medication record back is fine. Answer the rest of the message normally.',
      ].join('\n'),
    }
  }
  return null
}

// ---------------------------------------------------------------- compatibility (0.1.0 exports)

export type GuardHit =
  | { code: 'emergency'; reply_zh: string }
  | { code: 'no_medication_change'; reply_zh: string }

/** The rules as one hit: an emergency (self-harm included) or a medicine change. */
export function preGuard(text: string): GuardHit | null {
  const labels = ruleLabels(text)
  if (labels.acute_emergency || labels.self_harm) return { code: 'emergency', reply_zh: EMERGENCY_REPLY_ZH }
  if (labels.med_change_request) return { code: 'no_medication_change', reply_zh: NO_MEDICATION_CHANGE_ZH }
  return null
}

/** The guidance note text for a hit. The person's words are not repeated: the note is appended, not substituted. */
export function wrapGuardMessage(_text: string, hit: GuardHit): string {
  const labels = noLabels(hit.code)
  if (hit.code === 'emergency') labels.acute_emergency = true
  else labels.med_change_request = true
  return guidanceNote(labels)?.text ?? ''
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

/** What the person typed in this step: user-sourced messages only, never plugin notes or tool results. */
export function personText(messages: readonly { source?: { kind?: string }; content?: unknown }[]): string {
  return messages
    .filter((message) => !message.source || message.source.kind === 'user')
    .map((message) => extractUserText(message.content))
    .filter((text) => text.trim())
    .join('\n')
}
