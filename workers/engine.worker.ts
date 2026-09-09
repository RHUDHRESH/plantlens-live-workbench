/// <reference lib="webworker" />
import { Runtime } from "@/lib/simulation/runtime";
import type { WorkerPush, WorkerRequest, WorkerResponse } from "@/lib/simulation/protocol";
import { buildSamplePack } from "@/lib/fixtures/pack";
import { runEvaluation } from "@/lib/simulation/evaluation";

/**
 * Engine worker: hosts the Runtime and drives it with a wall-clock tick. Snapshots are
 * pushed at a bounded rate (≈4 Hz) and only while something changed or playback runs.
 */

const ctx = self as unknown as DedicatedWorkerGlobalScope;
const runtime = new Runtime();
let initialised = false;
let lastWall = performance.now();
let lastPush = 0;
let dirty = false;

function post(msg: WorkerResponse | WorkerPush): void {
  ctx.postMessage(msg);
}

function tick(): void {
  const now = performance.now();
  const delta = Math.min(1000, now - lastWall);
  lastWall = now;
  if (initialised) {
    const before = runtime.cursor;
    runtime.advance(delta);
    if (runtime.cursor !== before) dirty = true;
    if (dirty && now - lastPush >= 250) {
      lastPush = now;
      dirty = false;
      post({ id: -1, ok: true, type: "TICK", snapshot: runtime.snapshot() });
    }
  }
}

setInterval(tick, 50);

ctx.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const m = ev.data;
  try {
    switch (m.type) {
      case "INIT":
        runtime.init(m.cfg);
        initialised = true;
        dirty = true;
        post({ id: m.id, ok: true, type: "SNAPSHOT", snapshot: runtime.snapshot() });
        return;
      case "PLAY":
        runtime.play();
        lastWall = performance.now();
        break;
      case "PAUSE":
        runtime.pause();
        break;
      case "SET_SPEED":
        runtime.setSpeed(m.speed);
        break;
      case "SEEK":
        runtime.seek(m.ms);
        break;
      case "STEP":
        runtime.stepOnce();
        break;
      case "SET_HIDDEN":
        runtime.hiddenTab = m.hidden;
        lastWall = performance.now();
        break;
      case "SET_KNOWLEDGE":
        runtime.setKnowledge(m.knowledge);
        break;
      case "SET_BASELINES":
        runtime.setBaselines(m.baselines);
        break;
      case "INTERVENE": {
        const intervention = runtime.intervene(m.interventionId, m.params, m.by);
        dirty = true;
        post({ id: m.id, ok: true, type: "INTERVENTION", intervention });
        return;
      }
      case "START_RUN": {
        const run = runtime.startRun(m.plan, m.workOrderId);
        dirty = true;
        post({ id: m.id, ok: true, type: "RUN", run });
        return;
      }
      case "ABORT_RUN":
        runtime.abortRun(m.runId);
        break;
      case "REVIEW_RUN":
        runtime.reviewRun(m.runId, m.review);
        break;
      case "SET_INCIDENT_STATUS":
        runtime.setIncidentStatus(m.incidentId, m.status);
        break;
      case "LINK_INCIDENT":
        runtime.linkIncident(m.incidentId, { workOrderIds: m.workOrderIds, recoveryPlanIds: m.recoveryPlanIds });
        break;
      case "SERIES":
        post({ id: m.id, ok: true, type: "SERIES", series: runtime.series(m.query) });
        return;
      case "EVENTS":
        post({ id: m.id, ok: true, type: "EVENTS", events: runtime.events(m.tagIds, m.fromMs, m.toMs) });
        return;
      case "OBSERVATIONS":
        post({ id: m.id, ok: true, type: "OBSERVATIONS", observations: runtime.observations(m.ids) });
        return;
      case "EXPORT_OBSERVATIONS":
        post({ id: m.id, ok: true, type: "EXPORT_OBSERVATIONS", observations: runtime.exportObservations(m.fromMs, m.toMs) });
        return;
      case "LOAD_IMPORTED":
        runtime.loadImported(m.samples, m.alarms, m.importInfo);
        initialised = true;
        runtime.runDiagnosis(runtime.cursor, true);
        break;
      case "BUILD_PACK":
        post({ id: m.id, ok: true, type: "PACK", pack: buildSamplePack() });
        return;
      case "EVALUATE":
        post({ id: m.id, ok: true, type: "EVALUATION", report: runEvaluation(m.config) });
        return;
      case "SNAPSHOT":
        post({ id: m.id, ok: true, type: "SNAPSHOT", snapshot: runtime.snapshot() });
        return;
    }
    dirty = true;
    post({ id: m.id, ok: true, type: "SNAPSHOT", snapshot: runtime.snapshot() });
  } catch (e) {
    post({ id: m.id, ok: false, error: e instanceof Error ? e.message : String(e) });
  }
};
