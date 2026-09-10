import { EMPTY_ENGINEERING_STATE } from "./mapping";
import type { EngineeringState, EngineeringStateAdapter } from "./types";

const STORAGE_KEY = "plantlens.engineering-state.v1";

function desktop(): EngineeringStateAdapter | undefined {
  return typeof window === "undefined" ? undefined : (window as unknown as { plantlensDesktop?: EngineeringStateAdapter }).plantlensDesktop;
}

export async function loadEngineeringState(): Promise<EngineeringState> {
  const api = desktop();
  if (api?.engineeringStateLoad) return (await api.engineeringStateLoad()) ?? structuredClone(EMPTY_ENGINEERING_STATE);
  try { const raw = localStorage.getItem(STORAGE_KEY); return raw ? JSON.parse(raw) as EngineeringState : structuredClone(EMPTY_ENGINEERING_STATE); }
  catch { return structuredClone(EMPTY_ENGINEERING_STATE); }
}

export async function saveEngineeringState(state: EngineeringState, expectedRevision: number): Promise<EngineeringState> {
  const api = desktop();
  if (api?.engineeringStateSave) return api.engineeringStateSave(state, expectedRevision);
  const current = await loadEngineeringState();
  if (current.revision !== expectedRevision) throw new Error(`Version conflict: expected revision ${expectedRevision}, found ${current.revision}.`);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  return state;
}
