import { NdjsonDecoder, isRecoveryDevice, validateDescriptor, validateSample } from "../protocol.mjs";

export async function listSerialCandidates() {
  const { SerialPort } = await import("serialport");
  const ports = await SerialPort.list();
  return ports.map((port) => ({
    path: port.path,
    manufacturer: port.manufacturer ?? "Unknown",
    serialNumber: port.serialNumber ?? null,
    vendorId: port.vendorId ?? null,
    productId: port.productId ?? null,
    recoveryMode: isRecoveryDevice(port),
  }));
}

export async function openSelectedReadOnlyPort(path, { baudRate = 115200, timeoutMs = 5000 } = {}) {
  if (!path || typeof path !== "string" || !/^COM\d+$/i.test(path)) throw new Error("An explicit Windows COM path is required.");
  if (baudRate === 1200) throw new Error("1200-baud bootloader touch is forbidden.");
  const candidates = await listSerialCandidates();
  const candidate = candidates.find((port) => port.path.toLowerCase() === path.toLowerCase());
  if (!candidate) throw new Error("Selected port is no longer present.");
  if (candidate.recoveryMode) throw new Error("Recovery/EDL devices cannot be opened as telemetry sources.");

  const { SerialPort } = await import("serialport");
  const port = new SerialPort({ path: candidate.path, baudRate, autoOpen: false, rtscts: false });
  await new Promise((resolve, reject) => port.open((error) => error ? reject(error) : resolve()));

  const decoder = new NdjsonDecoder();
  let descriptor;
  const listeners = new Set();
  const pending = [];

  const onData = (chunk) => {
    try {
      for (const frame of decoder.push(chunk)) {
        if (!descriptor) {
          const checked = validateDescriptor(frame);
          if (!checked.ok) continue;
          descriptor = checked.descriptor;
          pending.splice(0).forEach((resolve) => resolve(descriptor));
        } else {
          const checked = validateSample(frame, descriptor);
          if (checked.ok) listeners.forEach((listener) => listener(checked.sample));
        }
      }
    } catch {
      // Corrupt input is quarantined; raw device data is never reflected to clients.
    }
  };
  port.on("data", onData);

  const verify = () => descriptor ? Promise.resolve(descriptor) : new Promise((resolve, reject) => {
    pending.push(resolve);
    setTimeout(() => reject(new Error("Timed out waiting for the broadcast PlantLens descriptor.")), timeoutMs);
  });

  return {
    verify,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async close() {
      port.off("data", onData);
      listeners.clear();
      await new Promise((resolve) => port.close(() => resolve()));
    },
  };
}
