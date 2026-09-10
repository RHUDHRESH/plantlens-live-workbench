import { describe, expect, it } from "vitest";
import { LIVE_SPECIALISTS, runLiveConfigurationGraph } from "@/lib/agents";

describe("live configuration LangGraph", () => {
  it("runs all ten bounded specialists sequentially and preserves the hardware activation gate", async () => {
    const result = await runLiveConfigurationGraph({
      request: "Build an induction motor twin from the verified demonstration descriptor.",
      hasVerifiedDevice: true,
      hasExactHardwareModels: false,
    });
    expect(result.completed).toEqual([...LIVE_SPECIALISTS]);
    expect(result.activationBlocked).toBe(true);
    expect(result.warnings).toHaveLength(1);
  });
});
