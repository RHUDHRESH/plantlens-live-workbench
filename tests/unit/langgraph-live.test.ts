import { describe, expect, it } from "vitest";
import { LIVE_SPECIALISTS, runLiveConfigurationGraph } from "@/lib/agents";

describe("live configuration LangGraph", () => {
  it("reports actual specialist outcomes and preserves the hardware activation gate", async () => {
    const result = await runLiveConfigurationGraph({
      request: "Build an induction motor twin from the verified demonstration descriptor.",
      hasVerifiedDevice: true,
      hasExactHardwareModels: false,
    });
    expect(result.outcomes.map(item => item.specialist)).toEqual([...LIVE_SPECIALISTS]);
    expect(result.completed).not.toEqual([...LIVE_SPECIALISTS]);
    expect(result.outcomes.find(item => item.specialist === "Official Manual Research")?.status).toBe("BLOCKED");
    expect(result.outcomes.find(item => item.specialist === "Diagnostic-Rule")?.status).toBe("SKIPPED");
    expect(result.activationBlocked).toBe(true);
    expect(result.warnings).toHaveLength(1);
  });
  it("does not claim research or mapping completion from prerequisite booleans", async () => {
    const result = await runLiveConfigurationGraph({ request: "Draft a reviewed motor monitoring configuration.", hasVerifiedDevice: true, hasExactHardwareModels: true });
    expect(result.activationBlocked).toBe(false);
    expect(result.warnings).toEqual([]);
    expect(result.outcomes.find(item => item.specialist === "Official Manual Research")?.status).toBe("SKIPPED");
    expect(result.outcomes.find(item => item.specialist === "Channel-Mapping")?.status).toBe("SKIPPED");
  });
});
