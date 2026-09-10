import { describe, expect, it } from "vitest";
import {
  buildCoverageRows,
  findDagCycle,
  type AnalysisRelationship,
} from "@/lib/analysis-workspace";
import type { CadAsset } from "@/lib/cad/types";
import type { EngineeringBinding } from "@/lib/engineering";

const assets: CadAsset[] = [
  { id: "A", name: "A", kind: "sensor", description: "", terminalIds: [] },
  { id: "B", name: "B", kind: "motor", description: "", terminalIds: [] },
  { id: "C", name: "C", kind: "drive", description: "", terminalIds: [] },
];
const edge = (
  fromAssetId: string,
  toAssetId: string,
  kind: AnalysisRelationship["kind"] = "DAG",
): AnalysisRelationship => ({
  id: `${fromAssetId}-${toAssetId}`,
  fromAssetId,
  toAssetId,
  kind,
  label: "test",
  sign: 1,
  note: "",
});
const binding = (
  assetId: string,
  state: EngineeringBinding["state"],
  pins = true,
): EngineeringBinding => ({
  id: "b",
  assetId,
  deviceUuid: pins ? "device" : "",
  schemaHash: pins ? "schema" : "",
  channelId: pins ? "channel" : "",
  signal: "value",
  dataType: "FLOAT32",
  sourceUnit: "unit",
  canonicalUnit: "unit",
  scale: 1,
  offset: 0,
  range: { min: 0, max: 1 },
  cadenceMs: 1000,
  state,
  createdAtMs: 0,
  createdBy: "test",
});

describe("analysis workspace", () => {
  it("detects DAG cycles while allowing loops to be separate", () => {
    expect(
      findDagCycle([edge("A", "B"), edge("B", "C"), edge("C", "A")]),
    ).toEqual(["A", "B", "C", "A"]);
    expect(findDagCycle([edge("A", "B"), edge("B", "A", "LOOP")])).toBeNull();
  });
  it("never reports absent or unverified bindings as healthy", () => {
    const rows = buildCoverageRows(assets, [
      binding("A", "PROPOSED"),
      binding("B", "APPROVED", false),
    ]);
    expect(rows.map((r) => r.status)).toEqual([
      "UNVERIFIED",
      "UNVERIFIED",
      "MISSING",
    ]);
    expect(
      buildCoverageRows(assets, [binding("A", "APPROVED")])[0].status,
    ).toBe("MAPPED");
  });
});
