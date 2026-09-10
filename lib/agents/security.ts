import { AGENT_TOOL_NAMES, PROPOSE_TOOL_NAMES, READ_TOOL_NAMES, type AgentDefinition, type AgentToolInvocation, type AgentToolMode, type AgentToolName } from "./types";

export const FORBIDDEN_HARDWARE_ACTIONS = [
  "start or stop machinery",
  "open or close a valve",
  "energise or de-energise equipment",
  "reset, acknowledge, or bypass an alarm or interlock",
  "change a PLC, SCADA, CNC, robot, drive, or controller setpoint",
  "jog or move an actuator, robot, spindle, conveyor, clamp, or axis",
  "write a tag or issue a field-device command",
] as const;

const HARDWARE_TARGET = /\b(?:plc|scada|cnc|robot|machine|motor|pump|compressor|spindle|conveyor|valve|clamp|axis|actuator|interlock|alarm|drive|breaker|relay|tag|setpoint)\b/i;
const HARDWARE_VERB = /\b(?:start|stop|open|close|energ(?:ize|ise)|de-energ(?:ize|ise)|reset|acknowledge|bypass|override|disable|enable|write|set|change|jog|move|run|trip|clear|command|actuate)\b/i;
const RECORD_MUTATION = /\b(?:approve|publish|delete|close|reject|sign[ -]?off|commit|apply|execute)\b.{0,50}\b(?:proposal|knowledge|incident|work order|recovery plan|change)\b/i;

const INJECTION_PATTERNS = [
  /\bignore\s+(?:all\s+)?(?:previous|prior|system|developer)\s+(?:instructions?|rules?|prompts?)\b/i,
  /\b(?:system|developer)\s+(?:message|prompt)\s*:/i,
  /\bdo\s+not\s+follow\s+(?:the\s+)?(?:safety|approval|review|policy)\b/i,
  /\b(?:reveal|print|return|exfiltrate)\b.{0,40}\b(?:secret|api key|password|token|system prompt)\b/i,
  /\bpretend\s+(?:you|the proposal)\b.{0,40}\b(?:approved|authori[sz]ed|administrator)\b/i,
] as const;

export interface PromptInjectionScan {
  detected: boolean;
  matches: string[];
}

export function scanPromptInjection(text: string): PromptInjectionScan {
  const matches = INJECTION_PATTERNS.filter((pattern) => pattern.test(text)).map((pattern) => pattern.source);
  return { detected: matches.length > 0, matches };
}

export function findProhibitedAction(text: string): string | undefined {
  const trimmed = text.trim();
  const imperativeHardwareRequest =
    HARDWARE_VERB.test(trimmed) &&
    HARDWARE_TARGET.test(trimmed) &&
    (new RegExp(`^(?:please\\s+)?${HARDWARE_VERB.source}`, "i").test(trimmed) ||
      /\b(?:please|now|immediately|can you|could you|you must|tell (?:the )?system to|issue (?:a )?command to)\b/i.test(trimmed));
  if (imperativeHardwareRequest) return "Direct or indirect hardware actuation is forbidden.";
  if (RECORD_MUTATION.test(text)) return "Agents may draft proposals but cannot approve, publish, close, or apply them.";
  return undefined;
}

const SECRET_PATTERNS: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  { label: "API_KEY", pattern: /\b(?:sk|rk|pk)-(?:live-|test-)?[a-z0-9_-]{16,}\b/gi },
  { label: "TOKEN", pattern: /\b(?:bearer\s+)[a-z0-9._~+/=-]{12,}\b/gi },
  { label: "SECRET", pattern: /\b((?:api[_ -]?key|password|passwd|secret|access[_ -]?token)\s*[:=]\s*)[^\s,;]+/gi },
  { label: "CONNECTION_STRING", pattern: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s]+/gi },
] as const;

export function redactSensitiveText(text: string): string {
  let redacted = text;
  for (const item of SECRET_PATTERNS) {
    redacted = redacted.replace(item.pattern, (match, prefix: string | undefined) =>
      item.label === "SECRET" && prefix ? `${prefix}[REDACTED:${item.label}]` : `[REDACTED:${item.label}]`,
    );
  }
  return redacted;
}

export function redactSensitiveValue<T>(value: T): T {
  const seen = new WeakMap<object, unknown>();
  const visit = (item: unknown): unknown => {
    if (typeof item === "string") return redactSensitiveText(item);
    if (item === null || typeof item !== "object") return item;
    const prior = seen.get(item);
    if (prior) return prior;
    if (Array.isArray(item)) {
      const clone: unknown[] = [];
      seen.set(item, clone);
      for (const child of item) clone.push(visit(child));
      return clone;
    }
    const clone: Record<string, unknown> = {};
    seen.set(item, clone);
    for (const [key, child] of Object.entries(item)) {
      clone[key] = /password|passwd|secret|token|api.?key|authorization/i.test(key) ? "[REDACTED:FIELD]" : visit(child);
    }
    return clone;
  };
  return visit(value) as T;
}

export interface ToolPolicyDecision {
  allowed: boolean;
  reason: string;
}

export function toolMode(tool: AgentToolName): AgentToolMode {
  return (READ_TOOL_NAMES as readonly string[]).includes(tool) ? "READ" : "PROPOSE";
}

export function validateToolInvocation(invocation: AgentToolInvocation, definition: AgentDefinition): ToolPolicyDecision {
  if (!(AGENT_TOOL_NAMES as readonly string[]).includes(invocation.tool)) return { allowed: false, reason: `Unknown tool ${String(invocation.tool)}.` };
  if (!definition.allowedTools.includes(invocation.tool)) return { allowed: false, reason: `${definition.id} is not allowlisted for ${invocation.tool}.` };
  const expectedMode = toolMode(invocation.tool);
  if (invocation.mode !== expectedMode) return { allowed: false, reason: `${invocation.tool} must use ${expectedMode} mode.` };
  if (!(READ_TOOL_NAMES as readonly string[]).includes(invocation.tool) && !(PROPOSE_TOOL_NAMES as readonly string[]).includes(invocation.tool)) {
    return { allowed: false, reason: "Only read and propose tools are permitted." };
  }
  const prohibited = findProhibitedAction(JSON.stringify(invocation.input));
  if (prohibited) return { allowed: false, reason: prohibited };
  return { allowed: true, reason: `${invocation.tool} is allowlisted as ${expectedMode}.` };
}
