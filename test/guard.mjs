// The guard: clause-aware rules, and a pre-step listener that only appends. A negated symptom, a family
// member's history, a risk question or 不想活到120岁 is not an emergency; a real one, or real self-harm
// wording, gets the emergency note; a request to start, stop or change a medicine gets the no-change note.
// The person's words are never replaced or dropped: next() runs first and its decision is kept.
import assert from 'node:assert/strict'

const mod = await import('../lib/index.js')

const NONE = []
const cases = [
  // not an emergency, not a request
  ['无胸痛', NONE],
  ['否认胸痛', NONE],
  ['心电图未见异常，无胸痛', NONE],
  ['父亲有中风史', NONE],
  ['父母有早发心梗', NONE],
  ['我外公中风过，算吗？', NONE],
  ['我的中风风险高吗', NONE],
  ['no chest pain', NONE],
  ['I have no chest pain today', NONE],
  ['heart attack risk', NONE],
  ['stroke risk', NONE],
  ['heat stroke', NONE],
  ['my father had a stroke', NONE],
  ['我不想活到120岁', NONE],
  ['我不想死', NONE],
  ['体检报告写着胸痛待查', NONE],
  ['我现在在吃什么药', NONE],
  ['我去年停药了', NONE],
  ['医生给我开了二甲双胍', NONE],
  ['山药怎么吃', NONE],
  ['我的 LDL 是多少', NONE],
  // real emergencies
  ['我现在胸口剧痛出冷汗', ['acute_emergency']],
  ['突然说话不清一侧没力气', ['acute_emergency']],
  ['I have chest pain right now', ['acute_emergency']],
  ["I can't breathe", ['acute_emergency']],
  ['I can’t breathe', ['acute_emergency']],
  ['我胸痛喘不上气', ['acute_emergency']],
  ['我妈叫不醒了', ['acute_emergency']],
  // real self-harm wording
  ['我不想活了', ['self_harm']],
  ['想自杀', ['self_harm']],
  ['suicide', ['self_harm']],
  ['I want to die', ['self_harm']],
  // medicine-change requests
  ['帮我停掉阿司匹林', ['med_change_request']],
  ['我想把降压药停了', ['med_change_request']],
  ['can I stop my metformin', ['med_change_request']],
  ['我想把药停了', ['med_change_request']],
  ['二甲双胍要不要加量', ['med_change_request']],
  ['阿司匹林可以停吗？', ['med_change_request']],
  ['医生给我开了阿托伐他汀，我能不吃吗', ['med_change_request']],
]

// --- 1. the rules ------------------------------------------------------------------------------
for (const [text, expected] of cases) {
  const got = mod.ruleLabels(text)
  for (const key of mod.LABEL_KEYS) assert.equal(got[key], expected.includes(key), `${key}: ${text}`)
  const hit = mod.preGuard(text)
  if (expected.includes('acute_emergency') || expected.includes('self_harm')) assert.equal(hit?.code, 'emergency', text)
  else if (expected.includes('med_change_request')) assert.equal(hit?.code, 'no_medication_change', text)
  else assert.equal(hit, null, text)
}
// NFKC: full-width letters read as their ASCII forms.
assert.equal(mod.ruleLabels('ｃａｎ Ｉ ｓｔｏｐ ｍｙ ｍｅｔｆｏｒｍｉｎ').med_change_request, true, 'full-width text is normalised')
assert.equal(mod.mentionsMedicine('山药怎么吃'), false, '山药 is food')
assert.equal(mod.mentionsMedicine('阿司匹林'), true)

// --- 2. the notes ------------------------------------------------------------------------------
const emergency = mod.guidanceNote(mod.ruleLabels('我现在胸口剧痛出冷汗'))
assert.match(emergency.text, /120/)
assert.match(emergency.text, /988/, 'the US line stays')
assert.ok(emergency.text.includes(mod.EMERGENCY_REPLY_ZH))
assert.ok(emergency.summary.length <= 120)
const selfHarm = mod.guidanceNote(mod.ruleLabels('我不想活了'))
assert.ok(selfHarm.text.includes(mod.EMERGENCY_REPLY_ZH), 'self-harm gets the emergency note')
const change = mod.guidanceNote(mod.ruleLabels('帮我停掉阿司匹林'))
assert.ok(change.text.includes(mod.NO_MEDICATION_CHANGE_ZH))
assert.doesNotMatch(change.text, /120/)
assert.equal(mod.guidanceNote(mod.ruleLabels('父亲有中风史')), null)
// The 1.0.0 helper returns the note and never repeats the person's words.
const wrapped = mod.wrapGuardMessage('我胸痛，私密内容', mod.preGuard('我胸痛'))
assert.match(wrapped, /120/)
assert.equal(wrapped.includes('私密内容'), false, 'the note does not quote the person')
assert.doesNotMatch(wrapped, /The user said/)

// --- 3. the listener: appended, never replaced -------------------------------------------------
function fakeHost() {
  const listeners = {}
  const options = {}
  const ctx = {
    tools: { register: () => () => {} },
    skills: { register: () => () => {} },
    systemPrompt: { section: () => {}, context: () => {} },
    webServer: { register: () => () => {} },
    commands: { register: () => {} },
    inject: (_names, callback) => callback(ctx),
    on: (name, listener, option) => {
      ;(listeners[name] ??= []).push(listener)
      ;(options[name] ??= []).push(option)
      return () => {}
    },
  }
  return { ctx, listeners, options }
}

const host = fakeHost()
mod.apply(host.ctx, { pythonBin: '/nonexistent/python', mirobodyHome: '', mcpUrl: '', mcpToken: '', timeoutMs: 1000 })
assert.equal(host.listeners['agent/pre-step']?.length, 1, 'one pre-step listener')
assert.equal(host.options['agent/pre-step'][0], undefined, 'not prepended: a host that mounts this plugin keeps its own listener outermost')
const preStep = host.listeners['agent/pre-step'][0]

let seq = 0
const userMessage = (text) => Object.freeze({ id: `u${++seq}`, role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } })
const runtime = Object.freeze({ id: 'ctx', role: 'user', content: [{ type: 'text', text: 'runtime context' }], source: { kind: 'plugin', plugin: 'loop', form: 'snapshot', sections: [] } })

async function step(messages, { decide, signal } = {}) {
  let calls = 0
  const decision = decide ? decide(messages) : { kind: 'enter', messages: [...messages, runtime] }
  const out = await preStep({ agent: {}, messages, turn: 1, step: 1, signal: signal ?? new AbortController().signal }, async () => {
    calls += 1
    return decision
  })
  assert.equal(calls, 1, 'next() runs exactly once')
  return { out, decision }
}

for (const [text, expected] of cases) {
  const said = userMessage(text)
  const { out, decision } = await step([said])
  assert.equal(out.kind, 'enter')
  // The claimed messages come through as they were, the same objects in the same order.
  assert.equal(out.messages[0], said, `the person's message is kept: ${text}`)
  assert.equal(out.messages[0].content[0].text, text)
  assert.equal(out.messages[1], runtime, 'the rest of the decision is kept')
  if (expected.length === 0) {
    assert.equal(out, decision, `nothing added: ${text}`)
    continue
  }
  assert.equal(out.messages.length, decision.messages.length + 1, `one note appended: ${text}`)
  const note = out.messages.at(-1)
  assert.equal(note.role, 'user')
  assert.deepEqual({ ...note.source, summary: undefined }, { kind: 'plugin', plugin: 'dsh-plugin-mirobody', form: 'notice', summary: undefined })
  assert.ok(note.source.summary && note.source.summary.length <= 120)
  assert.ok(typeof note.id === 'string' && note.id.length > 0)
  assert.equal(note.content[0].text.includes(text), false, 'the note does not quote the person')
  if (expected.includes('med_change_request')) assert.ok(note.content[0].text.includes(mod.NO_MEDICATION_CHANGE_ZH), text)
  else assert.ok(note.content[0].text.includes(mod.EMERGENCY_REPLY_ZH), text)
}

// A rejection from the rest of the chain stands, untouched.
const rejected = await step([userMessage('我胸痛')], { decide: () => ({ kind: 'reject' }) })
assert.deepEqual(rejected.out, { kind: 'reject' })
assert.equal(rejected.out, rejected.decision)

// Only the person's own words count: a tool result or another plugin's notice with 胸痛 or 停药 adds nothing.
const toolResult = Object.freeze({ id: 't1', role: 'user', content: [{ type: 'text', text: '主诉：胸痛。医嘱：停药观察，阿司匹林停掉。' }], source: { kind: 'tool', callId: 'c1' } })
const otherNote = Object.freeze({ id: 'n1', role: 'user', content: [{ type: 'text', text: '我胸痛，帮我停掉阿司匹林' }], source: { kind: 'plugin', plugin: 'other', form: 'notice', summary: 'x' } })
const quiet = await step([toolResult, otherNote])
assert.equal(quiet.out, quiet.decision, 'tool results and plugin notices are not classified')
const mixed = await step([toolResult, userMessage('帮我停掉阿司匹林')])
assert.equal(mixed.out.messages.length, mixed.decision.messages.length + 1)
assert.equal(mixed.out.messages[0], toolResult)

// A decision the chain changed (another listener appended its own context) keeps that change.
const extra = Object.freeze({ id: 'x', role: 'user', content: [{ type: 'text', text: 'extra' }], source: { kind: 'plugin', plugin: 'other' } })
const changed = await step([userMessage('我现在胸口剧痛出冷汗')], { decide: (messages) => ({ kind: 'enter', messages: [...messages, extra], startsRequestSeries: true }) })
assert.equal(changed.out.startsRequestSeries, true)
assert.equal(changed.out.messages[1], extra)
assert.equal(changed.out.messages.length, 3)

// A cancelled turn adds nothing.
const controller = new AbortController()
controller.abort()
const cancelled = await step([userMessage('我胸痛')], { signal: controller.signal })
assert.equal(cancelled.out, cancelled.decision)

// The listener is the exported guardPreStep.
const direct = await mod.guardPreStep({ messages: [userMessage('我想把降压药停了')] }, async () => ({ kind: 'enter', messages: [] }))
assert.equal(direct.messages.length, 1)
assert.equal(direct.messages[0].source.form, 'notice')

console.log('guard ok', { cases: cases.length })
