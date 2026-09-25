// The agent/pre-step listener. It never replaces or drops the person's words: it keeps the decision
// the rest of the chain made (the loop's runtime context included) and, when the rules flag the
// person's own text, appends one plugin notice after it for the model.

import { randomUUID } from 'node:crypto'
import { guidanceNote, personText, ruleLabels, type GuidanceNote } from './guardrails.ts'
import { PRODUCT_NAME } from './version.ts'

/** dsh-agent's PreStepDecision, restated over the message type. */
export type PreStepDecision<M> = { kind: 'reject' } | { kind: 'enter'; messages: M[]; startsRequestSeries?: true }

export interface StepMessage {
  readonly source?: { readonly kind?: string }
  readonly content?: unknown
}

/** A user-role message sourced to this plugin, in DSH's `notice` form: shown as one collapsed row. */
export interface NoteMessage {
  readonly id: string
  readonly role: 'user'
  readonly content: ReadonlyArray<{ readonly type: 'text'; readonly text: string }>
  readonly source: { readonly kind: 'plugin'; readonly plugin: string; readonly form: 'notice'; readonly summary: string }
}

export function noteMessage(note: GuidanceNote): NoteMessage {
  return Object.freeze({
    id: randomUUID(),
    role: 'user',
    content: Object.freeze([Object.freeze({ type: 'text', text: note.text } as const)]),
    source: Object.freeze({ kind: 'plugin', plugin: PRODUCT_NAME, form: 'notice', summary: note.summary.slice(0, 120) } as const),
  } as const)
}

/**
 * Call next() first and keep its decision. A rejection or an empty step passes through untouched; a flagged
 * step gets one note appended after the claimed messages. Any failure here keeps the decision as it was.
 */
export async function guardPreStep<M extends StepMessage>(
  payload: { readonly messages: readonly M[]; readonly signal?: AbortSignal },
  next: () => Promise<PreStepDecision<M>>,
): Promise<PreStepDecision<M>> {
  const decision = await next()
  try {
    if (decision.kind !== 'enter' || payload.signal?.aborted) return decision
    const text = personText(payload.messages)
    if (!text.trim()) return decision
    const note = guidanceNote(ruleLabels(text))
    if (!note) return decision
    return { ...decision, messages: [...decision.messages, noteMessage(note) as unknown as M] }
  } catch {
    return decision
  }
}
