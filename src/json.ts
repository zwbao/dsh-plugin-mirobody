import type { JsonValue } from '@deepseek-ai/dsh-util-values'

export function asJson(value: unknown): JsonValue {
  return value as JsonValue
}
