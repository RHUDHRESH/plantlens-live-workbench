import { isIP } from "node:net";
import { validateDescriptor, validateSample } from "../protocol.mjs";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
function privateIp(host) {
  if (isIP(host) !== 4) return false;
  const [a, b] = host.split(".").map(Number);
  return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

export function validateAppLabAddress(address, credential) {
  const url = new URL(address);
  if (url.username || url.password || url.search || url.hash) throw new Error("Credentials, query strings, and fragments are not allowed in the address.");
  const host = url.hostname.toLowerCase();
  if (url.protocol === "http:" && !LOOPBACK.has(host)) throw new Error("Plain HTTP is restricted to local loopback/App Lab forwarding.");
  if (url.protocol === "https:" && !(LOOPBACK.has(host) || privateIp(host))) throw new Error("HTTPS requires a loopback hostname or private literal IPv4 address.");
  if (url.protocol === "https:" && !LOOPBACK.has(host) && !credential) throw new Error("A credential is required for a LAN UNO Q connection.");
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error("Only HTTP(S) App Lab transport is supported.");
  url.pathname = url.pathname.replace(/\/$/, "");
  return url;
}

export async function openUnoQHttp({ address, expectedDeviceUuid, credential, pollMs = 250, staleAfterMs = 1500, requestTimeoutMs = 5000, maximumResponseBytes = 1024 * 1024, fetchImpl = fetch }) {
  if (!expectedDeviceUuid) throw new Error("The selected UNO Q expected UUID is required.");
  const base = validateAppLabAddress(address, credential);
  const headers = credential ? { authorization: `Bearer ${credential}` } : {};
  const lifecycle = new AbortController();
  const get = async (path) => {
    const requestController = new AbortController();
    const abort = () => requestController.abort(lifecycle.signal.reason);
    lifecycle.signal.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(() => requestController.abort(new Error("UNO Q request timed out.")), Math.max(100, Math.min(30_000, requestTimeoutMs)));
    try {
      const response = await fetchImpl(new URL(`${base.pathname}${path}`, base), { headers, signal: requestController.signal, redirect: "error" });
      if (!response.ok || !response.body) throw new Error(`UNO Q App Lab returned HTTP ${response.status}.`);
      const declared = Number(response.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > maximumResponseBytes) throw new Error("UNO Q response exceeds the allowed size.");
      const reader = response.body.getReader();
      const chunks = []; let received = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > maximumResponseBytes) { await reader.cancel(); throw new Error("UNO Q response exceeds the allowed size."); }
        chunks.push(value);
      }
      const bytes = new Uint8Array(received); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      return JSON.parse(new TextDecoder().decode(bytes));
    } finally {
      clearTimeout(timeout);
      lifecycle.signal.removeEventListener("abort", abort);
    }
  };
  const checked = validateDescriptor(await get("/plantlens/v1/descriptor"));
  if (!checked.ok) throw new Error(checked.error);
  if (checked.descriptor.deviceUuid !== expectedDeviceUuid) throw new Error("UNO Q identity does not match the selected expected UUID.");
  const descriptor = checked.descriptor;
  let closed = false, timer, lastSequence = -1;
  const listeners = new Set();
  const diagnostics = { polls: 0, pollFailures: 0, gaps: 0, staleTransitions: 0, duplicateSamples: 0, lastSampleAtMs: null, stale: true, error: null, requiresReconnect: false };
  async function poll() {
    if (closed) return;
    try {
      diagnostics.polls++;
      const snapshot = await get("/plantlens/v1/snapshot");
      if (snapshot?.descriptor?.deviceUuid !== descriptor.deviceUuid || snapshot?.descriptor?.bootId !== descriptor.bootId || snapshot?.descriptor?.schemaHash !== descriptor.schemaHash) {
        diagnostics.stale = true; diagnostics.staleTransitions++; diagnostics.requiresReconnect = true;
        diagnostics.error = "UNO Q rebooted or identity/schema changed; reconnect and verify it again.";
        return;
      }
      for (const sample of Array.isArray(snapshot.samples) ? snapshot.samples : []) {
        const valid = validateSample(sample, descriptor);
        if (!valid.ok) continue;
        if (sample.sequence <= lastSequence) { diagnostics.duplicateSamples++; continue; }
        if (lastSequence >= 0 && sample.sequence > lastSequence + 1) diagnostics.gaps += sample.sequence - lastSequence - 1;
        lastSequence = sample.sequence; diagnostics.lastSampleAtMs = Date.now();
        if (diagnostics.stale) diagnostics.stale = false;
        listeners.forEach((listener) => listener(valid.sample));
      }
      if (!diagnostics.stale && diagnostics.lastSampleAtMs && Date.now() - diagnostics.lastSampleAtMs > staleAfterMs) { diagnostics.stale = true; diagnostics.staleTransitions++; }
    } catch (error) { if (!closed) { diagnostics.pollFailures++; diagnostics.error = error instanceof Error ? error.message : "UNO Q polling failed."; } }
    if (!closed && !diagnostics.requiresReconnect) timer = setTimeout(poll, Math.max(100, Math.min(5000, pollMs)));
  }
  poll();
  return { verify: async () => descriptor, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }, diagnostics: () => ({ ...diagnostics }), async close() { closed = true; clearTimeout(timer); lifecycle.abort(new Error("UNO Q transport closed.")); listeners.clear(); } };
}
