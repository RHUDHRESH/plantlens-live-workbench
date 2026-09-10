import { describe, expect, it } from "vitest";
import { proposedMappings } from "@/components/live/LiveWorkspace";
import { DEMO_PROFILE } from "@/lib/live";

describe("live workspace proposal mappings", () => {
  it("converts the demo 4–20 mA temperature signal to Celsius", () => {
    const mapping = proposedMappings(DEMO_PROFILE).find((item) => item.channelId === "sensor.bearing_temperature");
    expect(mapping).toMatchObject({ canonicalUnit: "°C", scale: 6.25, offset: -25 });
    expect(11.9 * mapping!.scale + mapping!.offset).toBeCloseTo(49.375);
  });

  it("only proposes the demo pulse-to-rpm assumption for the verified simulator", () => {
    const demo = proposedMappings(DEMO_PROFILE).find((item) => item.channelId === "sensor.shaft_pulses");
    expect(demo).toMatchObject({ signal: "shaft_speed", canonicalUnit: "rpm", scale: 60 });

    const physicalProfile = { ...DEMO_PROFILE, deviceUuid: "08715f9e-9ad3-4cbc-a469-a155729ae39f" };
    const physical = proposedMappings(physicalProfile).find((item) => item.channelId === "sensor.shaft_pulses");
    expect(physical).toMatchObject({ assetId: "", signal: "", canonicalUnit: "pulses", scale: 1 });
  });
});
