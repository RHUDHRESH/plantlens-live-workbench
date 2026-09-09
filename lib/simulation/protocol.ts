import type { Alarm, HealthyBaseline, Incident, KnowledgeVersion, Observation, RecoveryPlan, RecoveryRun, ReviewRecord, Workspace } from "@/lib/domain/types";
import type { RecordedIntervention } from "./engine";
import type { Sample, SeriesPoint } from "./observation";
import type { RuntimeInit, RuntimeSnapshot, SeriesQuery } from "./runtime";
import type { InterventionId } from "./scenarios";
import type { SamplePack } from "@/lib/fixtures/pack";
import type { EvaluationConfig, EvaluationReport } from "./evaluation";

/** Worker message protocol. Every request has an id; the worker answers with the same id. */

export type WorkerRequest =
  | { id: number; type: "INIT"; cfg: RuntimeInit }
  | { id: number; type: "PLAY" }
  | { id: number; type: "PAUSE" }
  | { id: number; type: "SET_SPEED"; speed: number }
  | { id: number; type: "SEEK"; ms: number }
  | { id: number; type: "STEP" }
  | { id: number; type: "SET_HIDDEN"; hidden: boolean }
  | { id: number; type: "SET_KNOWLEDGE"; knowledge: KnowledgeVersion }
  | { id: number; type: "SET_BASELINES"; baselines: HealthyBaseline[] }
  | { id: number; type: "INTERVENE"; interventionId: InterventionId; params?: Record<string, number | string>; by: string }
  | { id: number; type: "START_RUN"; plan: RecoveryPlan; workOrderId?: string }
  | { id: number; type: "ABORT_RUN"; runId: string }
  | { id: number; type: "REVIEW_RUN"; runId: string; review: ReviewRecord }
  | { id: number; type: "SET_INCIDENT_STATUS"; incidentId: string; status: Incident["status"] }
  | { id: number; type: "LINK_INCIDENT"; incidentId: string; workOrderIds?: string[]; recoveryPlanIds?: string[] }
  | { id: number; type: "SERIES"; query: SeriesQuery }
  | { id: number; type: "EVENTS"; tagIds: string[]; fromMs: number; toMs: number }
  | { id: number; type: "OBSERVATIONS"; ids: string[] }
  | { id: number; type: "EXPORT_OBSERVATIONS"; fromMs: number; toMs: number }
  | { id: number; type: "LOAD_IMPORTED"; samples: Array<{ tagId: string; sample: Sample }>; alarms: Alarm[]; importInfo: Workspace["importInfo"] }
  | { id: number; type: "BUILD_PACK" }
  | { id: number; type: "EVALUATE"; config: EvaluationConfig }
  | { id: number; type: "SNAPSHOT" };

export type WorkerResponse =
  | { id: number; ok: true; type: "SNAPSHOT"; snapshot: RuntimeSnapshot }
  | { id: number; ok: true; type: "SERIES"; series: Record<string, SeriesPoint[]> }
  | { id: number; ok: true; type: "EVENTS"; events: Record<string, Array<{ ms: number; uncertaintyMs: number; cycleId?: string; clockSourceId?: string; rawMs?: number }>> }
  | { id: number; ok: true; type: "OBSERVATIONS"; observations: Observation[] }
  | { id: number; ok: true; type: "EXPORT_OBSERVATIONS"; observations: Observation[] }
  | { id: number; ok: true; type: "INTERVENTION"; intervention: RecordedIntervention }
  | { id: number; ok: true; type: "RUN"; run: RecoveryRun }
  | { id: number; ok: true; type: "PACK"; pack: SamplePack }
  | { id: number; ok: true; type: "EVALUATION"; report: EvaluationReport }
  | { id: number; ok: true; type: "ACK" }
  | { id: number; ok: false; error: string };

export type WorkerPush = { id: -1; ok: true; type: "TICK"; snapshot: RuntimeSnapshot };
