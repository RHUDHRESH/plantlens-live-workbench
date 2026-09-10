import { z } from "zod";
import { DeterministicAgentSupervisor, LangGraphJsAdapter, PlantLensLangGraphRuntime } from "@/lib/agents";

export const runtime = "nodejs";

const RequestSchema = z.object({
  text: z.string().trim().min(1).max(4_000),
  evidence: z.array(z.object({
    id: z.string().min(1).max(160),
    official: z.literal(true),
    kind: z.enum(["SOURCE_DOCUMENT", "PUBLISHED_KNOWLEDGE", "OBSERVATION", "INCIDENT_RECORD", "RECOVERY_RUN", "WORK_ORDER"]),
    title: z.string().max(300),
    excerpt: z.string().max(4_000),
    locator: z.string().max(1_000),
    observedAtMs: z.number().int().nonnegative().optional(),
    sourceVersion: z.string().max(160).optional(),
  })).max(24).default([]),
});

export async function POST(request: Request) {
  const parsed = RequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid bounded agent request.", issues: parsed.error.issues }, { status: 400 });
  const adapter = new LangGraphJsAdapter(new PlantLensLangGraphRuntime(), { requiresApiKey: false });
  const run = await new DeterministicAgentSupervisor({ adapter }).run(parsed.data);
  return Response.json(run, { headers: { "Cache-Control": "no-store" } });
}
