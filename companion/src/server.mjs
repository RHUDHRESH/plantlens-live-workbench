import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { CompanionStore } from "./store.mjs";
import { DemoTransport } from "./transports/demo.mjs";
import { listSerialCandidates, openSelectedReadOnlyPort } from "./transports/serial.mjs";

const HOST = "127.0.0.1";
const PORT = Number(process.env.PLANTLENS_COMPANION_PORT ?? 43117);
const TOKEN = process.env.PLANTLENS_COMPANION_TOKEN ?? randomBytes(24).toString("base64url");
const allowedOrigins = new Set([`http://${HOST}:${PORT}`, "http://localhost:3000", "http://127.0.0.1:3000"]);
const dataDir = join(homedir(), ".plantlens");
mkdirSync(dataDir, { recursive: true });
const store = new CompanionStore(join(dataDir, "plantlens.db"));

let active = null;
let unsubscribe = null;
let descriptor = null;
let latest = null;
const streams = new Set();

function corsHeaders(request) {
  const origin = request.headers.origin;
  return origin && allowedOrigins.has(origin) ? {
    "access-control-allow-origin": origin,
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    vary: "Origin",
  } : {};
}

function jsonFor(request, response, status, payload) {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff", ...corsHeaders(request) });
  response.end(JSON.stringify(payload));
}

function authorized(request) {
  const origin = request.headers.origin;
  return (!origin || allowedOrigins.has(origin)) && request.headers.authorization === `Bearer ${TOKEN}`;
}

async function body(request) {
  let value = "";
  for await (const chunk of request) {
    value += chunk;
    if (value.length > 16_384) throw new Error("Request body too large.");
  }
  return value ? JSON.parse(value) : {};
}

async function disconnect(actor = "local-operator") {
  if (unsubscribe) unsubscribe();
  unsubscribe = null;
  if (active?.close) await active.close();
  active = null;
  descriptor = null;
  latest = null;
  store.appendAudit({ actor, kind: "DEVICE_DISCONNECTED", subjectId: "device-session", detail: { reason: "operator request" } });
}

async function connect(transport, actor) {
  await disconnect(actor);
  descriptor = await transport.verify();
  active = transport;
  unsubscribe = active.subscribe((sample) => {
    latest = sample;
    const payload = `data: ${JSON.stringify(sample)}\n\n`;
    streams.forEach((response) => response.write(payload));
  });
  store.appendAudit({ actor, kind: "DEVICE_CONNECTED", subjectId: descriptor.deviceUuid, detail: { boardModel: descriptor.boardModel, schemaHash: descriptor.schemaHash, writesSupported: false } });
  return descriptor;
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${HOST}:${PORT}`);
    if (request.method === "OPTIONS" && request.headers.origin && allowedOrigins.has(request.headers.origin)) {
      response.writeHead(204, corsHeaders(request));
      return response.end();
    }
    if (url.pathname === "/healthz") return jsonFor(request, response, 200, { ok: true, mode: "local", readOnly: true });
    if (!authorized(request)) return jsonFor(request, response, 401, { ok: false, error: "Unauthorized local companion request." });

    if (request.method === "GET" && url.pathname === "/v1/status") return jsonFor(request, response, 200, { ok: true, connected: Boolean(active), descriptor, latest, capabilities: ["DISCOVER", "CONNECT", "STREAM", "AUDIT"], writesSupported: false });
    if (request.method === "GET" && url.pathname === "/v1/devices") return jsonFor(request, response, 200, { ok: true, devices: await listSerialCandidates() });
    if (request.method === "GET" && url.pathname === "/v1/audit") return jsonFor(request, response, 200, { ok: true, events: store.listAudit(Number(url.searchParams.get("limit") ?? 100)) });
    if (request.method === "GET" && url.pathname === "/v1/stream") {
      response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive", ...corsHeaders(request) });
      streams.add(response);
      if (latest) response.write(`data: ${JSON.stringify(latest)}\n\n`);
      request.on("close", () => streams.delete(response));
      return;
    }

    if (request.method === "POST" && url.pathname === "/v1/connect/demo") {
      const input = await body(request);
      return jsonFor(request, response, 200, { ok: true, descriptor: await connect(new DemoTransport(), input.actor ?? "local-operator") });
    }
    if (request.method === "POST" && url.pathname === "/v1/connect/serial") {
      const input = await body(request);
      const transport = await openSelectedReadOnlyPort(input.path, { baudRate: input.baudRate ?? 115200 });
      return jsonFor(request, response, 200, { ok: true, descriptor: await connect(transport, input.actor ?? "local-operator") });
    }
    if (request.method === "POST" && url.pathname === "/v1/disconnect") {
      const input = await body(request);
      await disconnect(input.actor ?? "local-operator");
      return jsonFor(request, response, 200, { ok: true });
    }
    return jsonFor(request, response, 404, { ok: false, error: "Unknown read-only companion endpoint." });
  } catch (error) {
    return jsonFor(request, response, 400, { ok: false, error: error instanceof Error ? error.message : "Companion request failed." });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`PlantLens companion listening on http://${HOST}:${PORT}`);
  console.log(`Pairing token: ${TOKEN}`);
  console.log("READ ONLY: no device-write, shell, terminal, reset, or firmware endpoints are present.");
});

async function shutdown() {
  await disconnect("system");
  store.close();
  server.close(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
