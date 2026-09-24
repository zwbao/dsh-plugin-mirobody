import Schema from '@deepseek-ai/schemastery'

export interface Config {
  pythonBin: string
  mirobodyHome: string
  mcpUrl: string
  mcpToken: string
  timeoutMs: number
}

export const Config: Schema<Config> = Schema.object({
  pythonBin: Schema.string().default(''),
  mirobodyHome: Schema.string().default(''),
  mcpUrl: Schema.string().default(''),
  mcpToken: Schema.string().default(''),
  timeoutMs: Schema.number().default(30000),
})
