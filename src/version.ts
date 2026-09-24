export const PRODUCT_VERSION = '1.0.0'
export const PRODUCT_NAME = 'dsh-plugin-mirobody'

export const TOOL_NAMES = [
  'resolve_indicator',
  'resolve_reading',
  'convert_unit',
  'normalize_unit',
  'query_health_indicators',
  'query_medications',
  'query_genetic_data',
  'mirobody_status',
] as const

export type ToolName = (typeof TOOL_NAMES)[number]
