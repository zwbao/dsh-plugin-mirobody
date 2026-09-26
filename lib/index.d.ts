import Schema from "@deepseek-ai/schemastery";
import { Context } from "@deepseek-ai/cordis";
import { IncomingMessage, ServerResponse } from "node:http";
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
declare const LABEL_KEYS: readonly ["acute_emergency", "self_harm", "med_change_request"];
type LabelKey = typeof LABEL_KEYS[number];
type GuardLabels = Record<LabelKey, boolean> & {
  reason: string;
};
/** Whether the text names a medicine or supplement: a generic word (not 山药), a known name, or a drug-name ending. */
declare function mentionsMedicine(text: string): boolean;
/**
 * Labels from the rules. An emergency needs an acute sign that is not negated, not a family member's
 * history, not past and not a risk question; self-harm needs real intent (not 我不想死, not
 * 不想活到120岁); a medicine request needs a medicine (not 山药) and a request to start, stop or change it
 * (not a record of what the person already did).
 */
declare function ruleLabels(input: string): GuardLabels;
declare const EMERGENCY_REPLY_ZH = "如果您正在经历紧急不适，请立即拨打 120 或当地急救电话。在美国可拨打或发短信至 988。我不能替代急救，也不会给出处理步骤。";
declare const NO_MEDICATION_CHANGE_ZH = "我不能建议开始、停止、加量、减量或更换药物。用药记录只读。调整处方请联系开具该药的医生。";
interface GuidanceNote {
  /** Model-facing text of the note. */
  text: string;
  /** One line for the transcript row. */
  summary: string;
}
/** The one note appended after the person's words for what was flagged, or null. Emergencies and self-harm come first. */
declare function guidanceNote(labels: GuardLabels): GuidanceNote | null;
type GuardHit = {
  code: 'emergency';
  reply_zh: string;
} | {
  code: 'no_medication_change';
  reply_zh: string;
};
/** The rules as one hit: an emergency (self-harm included) or a medicine change. */
declare function preGuard(text: string): GuardHit | null;
/** The guidance note text for a hit. The person's words are not repeated: the note is appended, not substituted. */
declare function wrapGuardMessage(_text: string, hit: GuardHit): string;
/** What the person typed in this step: user-sourced messages only, never plugin notes or tool results. */
declare function personText(messages: readonly {
  source?: {
    kind?: string;
  };
  content?: unknown;
}[]): string;
//#endregion
//#region src/guard.d.ts
/** dsh-agent's PreStepDecision, restated over the message type. */
type PreStepDecision<M> = {
  kind: 'reject';
} | {
  kind: 'enter';
  messages: M[];
  startsRequestSeries?: true;
};
interface StepMessage {
  readonly source?: {
    readonly kind?: string;
  };
  readonly content?: unknown;
}
/** A user-role message sourced to this plugin, in DSH's `notice` form: shown as one collapsed row. */
interface NoteMessage {
  readonly id: string;
  readonly role: 'user';
  readonly content: ReadonlyArray<{
    readonly type: 'text';
    readonly text: string;
  }>;
  readonly source: {
    readonly kind: 'plugin';
    readonly plugin: string;
    readonly form: 'notice';
    readonly summary: string;
  };
}
declare function noteMessage(note: GuidanceNote): NoteMessage;
/**
 * Call next() first and keep its decision. A rejection or an empty step passes through untouched; a flagged
 * step gets one note appended after the claimed messages. Any failure here keeps the decision as it was.
 */
declare function guardPreStep<M extends StepMessage>(payload: {
  readonly messages: readonly M[];
  readonly signal?: AbortSignal;
}, next: () => Promise<PreStepDecision<M>>): Promise<PreStepDecision<M>>;
//#endregion
//#region src/version.d.ts
declare const PRODUCT_VERSION = "0.1.1";
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
/**
 * The whole environment of the Python bridge. Never the harness's own (API keys, tokens, provider
 * settings): only what a Python process needs to start (PATH, HOME, locale, TMPDIR) and what
 * bridge/dsh_bridge.py reads (MIROBODY_HOME, the optional source checkout it puts on sys.path).
 * PYTHONNOUSERSITE=1 keeps ~/.local site-packages out, so mirobody must be installed in the
 * interpreter's own site-packages (a venv); PYTHONPATH is not passed, mirobodyHome is the way to add
 * a checkout. Not a sandbox.
 */
declare function bridgeEnv(home: string): Record<string, string>;
declare function runBridgeSync(python: string, home: string, payload: Record<string, unknown>, timeoutMs: number): EngineResult;
//#endregion
//#region src/routes.d.ts
type Handler = (req: IncomingMessage, res: ServerResponse) => void;
/**
 * The part of DSH's `connection` service (dsh-client-connection, HostConnectionHandle) the routes use:
 * the Host/Origin/Sec-Fetch-Site fence, then the signed `dsh-auth` cookie. 401 or 403 rejects.
 */
interface ConnectionGuard {
  requestRejection(request: {
    headers: IncomingMessage['headers'];
  }): 401 | 403 | undefined;
}
declare const CONNECTION_UNAVAILABLE = "mirobody: DeepSeek Harness connection service unavailable";
/** application/json, with or without a charset or other parameters. */
declare function isJsonRequest(req: Pick<IncomingMessage, 'headers'>): boolean;
/**
 * DSH's exact routes skip the /api prefix route and its checks, so every Mirobody handler runs them itself,
 * before anything else: no connection service, no route (503); then DSH's own rejection; then a write
 * that is not JSON (415), which a page on another site could otherwise send without a preflight.
 */
declare function guardRoute(connection: () => ConnectionGuard | null, handler: Handler): Handler;
//#endregion
//#region src/index.d.ts
declare const name = "dsh-plugin-mirobody";
declare const inject: string[];
declare function apply(ctx: Context, config: Config): void;
//#endregion
export { CONNECTION_UNAVAILABLE, Config, type ConnectionGuard, EMERGENCY_REPLY_ZH, type GuardHit, type GuardLabels, type GuidanceNote, LABEL_KEYS, NO_MEDICATION_CHANGE_ZH, PRODUCT_VERSION, TOOL_NAMES, apply, bridgeEnv, discoverPython, guardPreStep, guardRoute, guidanceNote, inject, isJsonRequest, mentionsMedicine, name, noteMessage, personText, preGuard, ruleLabels, runBridgeSync, validateGeneticQuery, validateHealthQuery, validateMedicationQuery, wrapGuardMessage };