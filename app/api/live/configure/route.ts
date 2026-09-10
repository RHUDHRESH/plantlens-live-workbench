import { z } from "zod";
import { runLiveConfigurationGraph } from "@/lib/agents";

export const runtime = "nodejs";

const RequestSchema = z.object({
  request: z.string().trim().min(1).max(4_000),
  hasVerifiedDevice: z.boolean(),
  hasExactHardwareModels: z.boolean().default(false),
});

export async function POST(request: Request) {
  const parsed = RequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid configuration request." }, { status: 400 });
  const result = await runLiveConfigurationGraph(parsed.data);
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
