import Schema from "@deepseek-ai/schemastery";
import { Context } from "@deepseek-ai/cordis";
//#region src/host-shims.d.ts
declare module '@deepseek-ai/cordis' {
  interface Context {
    slots: {
      inject: (name: string, factory: () => unknown) => unknown;
      register: (options: Record<string, unknown>, component: unknown) => unknown;
    };
    skills: {
      register(skill: {
        name: string;
        description: string;
        content: string;
        source?: string;
        invocation?: {
          modelInvocable: boolean;
          userInvocable: boolean;
        };
      }): () => void;
    };
    systemPrompt: {
      section(section: {
        name: string;
        order: number;
        text: string | (() => string);
      }): unknown;
      context(section: {
        name: string;
        order: number;
        text: string | (() => string);
      }): unknown;
    };
    webServer: {
      register(route: {
        kind: 'exact' | 'prefix';
        path: string;
        handler: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void;
      }): () => void;
    };
  }
}
//#endregion
//#region src/config.d.ts
interface Config {
  pythonBin: string;
  mirobodyHome: string;
  mcpUrl: string;
  mcpToken: string;
  timeoutMs: number;
}
declare const Config: Schema<Config>;
//#endregion
//#region src/guardrails.d.ts
type GuardHit = {
  code: 'emergency';
  reply_zh: string;
} | {
  code: 'no_medication_change';
  reply_zh: string;
};
declare function preGuard(text: string): GuardHit | null;
declare function wrapGuardMessage(text: string, hit: GuardHit): string;
//#endregion
//#region src/version.d.ts
declare const PRODUCT_VERSION = "1.0.0";
declare const TOOL_NAMES: readonly ["resolve_indicator", "resolve_reading", "convert_unit", "normalize_unit", "query_health_indicators", "query_medications", "query_genetic_data", "mirobody_status"];
//#endregion
//#region src/validate.d.ts
interface Rejection {
  parameter: string;
  reason: string;
}
declare function validateHealthQuery(args: Record<string, unknown>): Rejection[];
declare function validateMedicationQuery(args: Record<string, unknown>): Rejection[];
declare function validateGeneticQuery(args: Record<string, unknown>): Rejection[];
//#endregion
//#region src/engine.d.ts
interface EngineResult {
  ok: boolean;
  success?: boolean;
  error_kind?: string;
  error?: string;
  hint?: string;
  python?: string;
  version?: string;
  bundle?: string;
  message?: string;
  results?: unknown;
  result?: unknown;
  converted?: unknown;
  from_ucum?: string;
  to_ucum?: string;
  reason?: string;
}
declare function discoverPython(configured: string): string;
declare function runBridgeSync(python: string, home: string, payload: Record<string, unknown>, timeoutMs: number): EngineResult;
//#endregion
//#region src/index.d.ts
declare const name = "dsh-plugin-mirobody";
declare const inject: string[];
declare function apply(ctx: Context, config: Config): void;
//#endregion
export { Config, PRODUCT_VERSION, TOOL_NAMES, apply, discoverPython, inject, name, preGuard, runBridgeSync, validateGeneticQuery, validateHealthQuery, validateMedicationQuery, wrapGuardMessage };