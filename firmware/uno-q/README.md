# PlantLens UNO Q read-only gateway

This Arduino App Lab project follows the official dual-brain app structure: `python/main.py` runs on Debian and `sketch/sketch.ino` runs on the STM32 MCU.

The sketch samples `A0`, `A1`, and `A2` at 20 Hz and publishes only uncalibrated ADC counts. The Linux app exposes a self-describing GET/WebSocket service through the official WebUI brick. It has no write, reset, pin-control, VFD-control, terminal, or firmware endpoint.

## Safety gate

Do not connect a sensor, VFD terminal, motor conductor, mains conductor, or DC bus to the UNO Q until a qualified person has confirmed the exact sensor/VFD model, isolation, signal conditioner, voltage range, grounding, and wiring. Raw channels remain `UNMAPPED` until their manuals are cited and an engineer approves a PlantLens mapping.

## Provisioning

Set `PLANTLENS_DEVICE_UUID` to a durable, unique identifier in the App Lab environment before treating evidence as belonging to a persistent device. The default `UNPROVISIONED-UNO-Q` identifier is rejected for production activation.
