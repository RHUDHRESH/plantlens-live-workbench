# PlantLens UNO Q read-only gateway

This Arduino App Lab project follows the official dual-brain app structure: `python/main.py` runs on Debian and `sketch/sketch.ino` runs on the STM32 MCU.

The sketch explicitly configures 12-bit ADC reads, samples `A0`, `A1`, and `A2` at 20 Hz, and publishes only uncalibrated counts in the declared `0..4095` range. The Linux app exposes a self-describing GET/WebSocket service through the official WebUI brick. It has no write, reset, pin-control, VFD-control, terminal, or firmware endpoint.

The gateway rejects non-integer bridge fields, out-of-range sequence/timestamp values, and ADC counts outside the descriptor range. `GET /plantlens/v1/health` reports `descriptorMismatchCount` and `rejectedSamples` for diagnostics; it never includes raw exception or environment details.

## Verification status

This directory is an integration scaffold reviewed for protocol consistency. It has **not** been compiled for UNO Q, flashed, electrically validated, or exercised against real sensors in this repository. Before deployment, compile it with the target App Lab/core versions, verify that the core supports `analogReadResolution(12)`, then bench-test sample rate, ADC range, reconnect behavior, and WebUI delivery using isolated low-voltage test signals.

## Safety gate

Do not connect a sensor, VFD terminal, motor conductor, mains conductor, or DC bus to the UNO Q until a qualified person has confirmed the exact sensor/VFD model, isolation, signal conditioner, voltage range, grounding, and wiring. Raw channels remain `UNMAPPED` until their manuals are cited and an engineer approves a PlantLens mapping.

## Provisioning

Set `PLANTLENS_DEVICE_UUID` to a durable, unique identifier in the App Lab environment before treating evidence as belonging to a persistent device. The default `UNPROVISIONED-UNO-Q` identifier is rejected for production activation.

## Desktop connection

PlantLens connects to this App Lab service through fixed read-only descriptor and snapshot routes. The operator must select an App Lab forwarding/loopback address and confirm the provisioned device UUID. Plain HTTP is accepted only on loopback; private-LAN connections require a literal private IPv4 address, HTTPS, and credentials. Names such as `.local` remain disabled until PlantLens can pin and verify DNS resolution. The desktop does not accept an arbitrary telemetry endpoint.

COM is a separate compatibility path for firmware that broadcasts the negotiated PlantLens/1 NDJSON descriptor and samples. This App Lab HTTP gateway is not itself a COM protocol implementation.
