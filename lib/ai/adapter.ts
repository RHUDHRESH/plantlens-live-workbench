import { z } from "zod";
import type { SourceDocument } from "@/lib/domain/types";

/**
 * Provider-neutral AI adapter for knowledge compilation, plus the read-only live-source
 * adapter contract. Credentials never enter the browser: the connected provider calls a
 * server route that holds the key. The public no-key demo works with the local pipeline.
 */

export type AIMode = "LOCAL_DEMO" | "CONNECTED";

export interface AIStatus {
  mode: AIMode;
  configured: boolean;
  label: string;
  detail: string;
}

/** Structured proposal the connected model must return; validated before use. */
export const ModelEdgeProposalSchema = z.object({
  from: z.string().min(1).max(40),
  to: z.string().min(1).max(40),
  relation: z.enum(["ELECTRICAL_SUPPLY", "PNEUMATIC_PREREQUISITE", "COOLING", "THERMAL_SUPPLY", "MATERIAL_FLOW", "HANDSHAKE", "COMPONENT_OF"]),
  summary: z.string().min(1).max(300),
  citations: z.array(z.object({ sourceId: z.string(), startLine: z.number().int().min(1), endLine: z.number().int().min(1) })).min(1).max(5),
  applicableModes: z.array(z.enum(["AUTO", "MANUAL", "MAINTENANCE", "OFF", "UNKNOWN"])).max(5),
  uncertainty: z.string().max(300),
  temporalOnly: z.boolean(),
});

export const ModelOutputSchema = z.object({ proposals: z.array(ModelEdgeProposalSchema).max(20) });
export type ModelOutput = z.infer<typeof ModelOutputSchema>;

export interface ExcerptPayload {
  excerpts: Array<{ sourceId: string; fileName: string; startLine: number; text: string }>;
  assetIds: string[];
  question: string;
}

/** Verify returned citations point at real, non-empty lines in the supplied excerpts. */
export function verifyCitations(output: ModelOutput, docs: SourceDocument[]): { accepted: ModelOutput["proposals"]; rejected: Array<{ proposal: ModelOutput["proposals"][number]; reason: string }> } {
  const accepted: ModelOutput["proposals"] = [];
  const rejected: Array<{ proposal: ModelOutput["proposals"][number]; reason: string }> = [];
  for (const p of output.proposals) {
    const bad = p.citations.find((c) => {
      const d = docs.find((x) => x.id === c.sourceId);
      return !d || c.startLine < 1 || c.endLine > d.lines.length || c.startLine > c.endLine || d.lines.slice(c.startLine - 1, c.endLine).join("").trim() === "";
    });
    if (bad) rejected.push({ proposal: p, reason: `Citation ${bad.sourceId}:${bad.startLine}-${bad.endLine} does not resolve to non-empty lines.` });
    else accepted.push(p);
  }
  return { accepted, rejected };
}

export async function fetchAIStatus(): Promise<AIStatus> {
  try {
    const res = await fetch("/api/knowledge", { method: "GET" });
    const j = (await res.json()) as { configured: boolean; detail?: string };
    return j.configured ? { mode: "CONNECTED", configured: true, label: "Connected AI (server-side provider)", detail: j.detail ?? "Bounded model calls on selected excerpts." } : { mode: "LOCAL_DEMO", configured: false, label: "Local demo pipeline", detail: j.detail ?? "Not configured. Deterministic parsers, explicit rules, and template matching only. No language model is called." };
  } catch {
    return { mode: "LOCAL_DEMO", configured: false, label: "Local demo pipeline", detail: "Server route unavailable; local processing only." };
  }
}

export async function callConnectedAI(payload: ExcerptPayload, signal?: AbortSignal): Promise<{ ok: true; output: ModelOutput; tokens?: number } | { ok: false; error: string }> {
  const body = JSON.stringify(payload);
  if (body.length > 60_000) return { ok: false, error: "Request exceeds the 60 KB excerpt limit; select fewer excerpts." };
  const res = await fetch("/api/knowledge", { method: "POST", headers: { "content-type": "application/json" }, body, signal });
  const j = (await res.json()) as { ok?: boolean; output?: unknown; error?: string; tokens?: number };
  if (!res.ok || !j.ok) return { ok: false, error: j.error ?? `HTTP ${res.status}` };
  const parsed = ModelOutputSchema.safeParse(j.output);
  if (!parsed.success) return { ok: false, error: `Model output failed schema validation: ${parsed.error.issues[0]?.message ?? "invalid"}` };
  return { ok: true, output: parsed.data, tokens: j.tokens };
}

// ---------------------------------------------------------------------------
// Live-source adapter contract (read-only). No implementation ships in this build.
// ---------------------------------------------------------------------------

export interface LiveSourceAdapter {
  readonly id: string;
  readonly vendor: string;
  /** Verify connectivity; must not write to any device. */
  verify(): Promise<{ ok: boolean; detail: string }>;
  /** Subscribe to read-only tag updates. */
  subscribe(tagIds: string[], onSample: (tagId: string, value: number | boolean | string | null, eventMs: number, quality: string) => void): () => void;
  /** Adapters are forbidden from exposing write, command, or interlock operations. */
  readonly writesSupported: false;
}

export const LIVE_ADAPTER_STATUS = { configured: false as const, reason: "No adapter implemented. The LiveSourceAdapter contract is read-only by construction (writesSupported: false)." };
