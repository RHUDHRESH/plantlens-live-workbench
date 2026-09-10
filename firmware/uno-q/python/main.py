"""PlantLens read-only UNO Q gateway.

Built against the public Arduino App Lab pattern: the MCU emits Bridge.notify
events and the Linux side exposes GET/WebSocket telemetry through WebUI. No API
or Bridge callback in this app can write pins, registers, VFD parameters, or
firmware.
"""

from arduino.app_utils import App, Bridge, Logger
from arduino.app_bricks.web_ui import WebUI
from collections import deque
import hashlib
import json
import os
import time

logger = Logger("plantlens-readonly-gateway")
web_ui = WebUI()

PROTOCOL = {"major": 1, "minor": 0, "encoding": "json"}
DEVICE_UUID = os.getenv("PLANTLENS_DEVICE_UUID", "UNPROVISIONED-UNO-Q")
BOOT_ID = hashlib.sha256(f"{DEVICE_UUID}:{time.time_ns()}".encode()).hexdigest()[:16]
FIRMWARE_HASH = os.getenv(
    "PLANTLENS_FIRMWARE_HASH",
    hashlib.sha256(b"plantlens-uno-q-0.1.0").hexdigest(),
)

CHANNELS = [
    {
        "id": "sensor_1_raw",
        "label": "Sensor 1 raw",
        "valueType": "uint16",
        "unit": "count",
        "minimum": 0,
        "maximum": 4095,
        "sampleRateHz": 20,
        "access": "READ_ONLY",
        "mappingState": "UNMAPPED",
    },
    {
        "id": "sensor_2_raw",
        "label": "Sensor 2 raw",
        "valueType": "uint16",
        "unit": "count",
        "minimum": 0,
        "maximum": 4095,
        "sampleRateHz": 20,
        "access": "READ_ONLY",
        "mappingState": "UNMAPPED",
    },
    {
        "id": "sensor_3_raw",
        "label": "Sensor 3 raw",
        "valueType": "uint16",
        "unit": "count",
        "minimum": 0,
        "maximum": 4095,
        "sampleRateHz": 20,
        "access": "READ_ONLY",
        "mappingState": "UNMAPPED",
    },
]

SCHEMA_HASH = hashlib.sha256(
    json.dumps(CHANNELS, sort_keys=True, separators=(",", ":")).encode()
).hexdigest()

DESCRIPTOR = {
    "magic": "PLANTLENS/1",
    "protocol": PROTOCOL,
    "deviceUuid": DEVICE_UUID,
    "boardModel": "Arduino UNO Q",
    "firmwareHash": FIRMWARE_HASH,
    "bootId": BOOT_ID,
    "schemaHash": SCHEMA_HASH,
    "capabilities": ["DESCRIBE", "STREAM", "HEALTH"],
    "writesSupported": False,
    "clock": {"kind": "MONOTONIC_MS", "uncertaintyMs": 5},
    "channelCount": len(CHANNELS),
    "maximumRateHz": 20,
    "channels": CHANNELS,
}

samples = deque(maxlen=512)
last_sample_at = None
last_sequence = None
descriptor_seen = False
descriptor_mismatch_count = 0
rejected_sample_count = 0


def get_descriptor():
    return DESCRIPTOR


def get_snapshot():
    return {
        "descriptor": DESCRIPTOR,
        "samples": list(samples),
        "serverTimeMs": int(time.time() * 1000),
    }


def get_health():
    age_ms = None if last_sample_at is None else int((time.monotonic() - last_sample_at) * 1000)
    return {
        "ok": age_ms is not None and age_ms < 1000,
        "readOnly": True,
        "lastSequence": last_sequence,
        "sampleAgeMs": age_ms,
        "descriptorSeen": descriptor_seen,
        "descriptorMismatchCount": descriptor_mismatch_count,
        "rejectedSamples": rejected_sample_count,
        "bufferedSamples": len(samples),
    }


def on_descriptor(magic: str, board: str, firmware: str, channel_count: int, rate_hz: int):
    global descriptor_seen, descriptor_mismatch_count
    # The MCU announcement is checked, never used to mutate the static descriptor.
    try:
        descriptor_seen = (
            magic == "PLANTLENS/1"
            and board == "UNO-Q"
            and firmware == "pl-fw-0.1.0"
            and int(channel_count) == len(CHANNELS)
            and int(rate_hz) == 20
        )
    except (TypeError, ValueError):
        descriptor_seen = False
    if not descriptor_seen:
        descriptor_mismatch_count += 1
        logger.warning("Rejected incompatible MCU descriptor")


def on_sample(sequence: int, device_ms: int, sensor_1: int, sensor_2: int, sensor_3: int):
    global last_sample_at, last_sequence, rejected_sample_count
    try:
        sequence = int(sequence)
        device_ms = int(device_ms)
        values = [int(sensor_1), int(sensor_2), int(sensor_3)]
    except (TypeError, ValueError):
        rejected_sample_count += 1
        logger.warning("Rejected MCU sample containing non-integer fields")
        return

    if sequence < 0 or sequence > 0xFFFFFFFF or device_ms < 0 or device_ms > 0xFFFFFFFF:
        rejected_sample_count += 1
        logger.warning("Rejected MCU sample with invalid sequence or device timestamp")
        return

    if any(value < channel["minimum"] or value > channel["maximum"] for channel, value in zip(CHANNELS, values)):
        rejected_sample_count += 1
        logger.warning("Rejected MCU sample outside the declared ADC range")
        return

    received_ms = int(time.time() * 1000)
    batch = {
        "type": "sample",
        "deviceUuid": DEVICE_UUID,
        "schemaHash": SCHEMA_HASH,
        "bootId": BOOT_ID,
        "sequence": sequence,
        "deviceTimeMs": device_ms,
        "receivedTimeMs": received_ms,
        "quality": "GOOD" if descriptor_seen else "SUSPECT",
        "values": [
            {"channelId": channel["id"], "rawValue": value, "unit": "count"}
            for channel, value in zip(CHANNELS, values)
        ],
    }
    samples.append(batch)
    last_sample_at = time.monotonic()
    last_sequence = sequence
    try:
        web_ui.send_message("plantlens_sample", batch)
    except Exception as exc:
        logger.debug(f"No WebUI subscriber: {exc}")


web_ui.expose_api("GET", "/plantlens/v1/descriptor", get_descriptor)
web_ui.expose_api("GET", "/plantlens/v1/snapshot", get_snapshot)
web_ui.expose_api("GET", "/plantlens/v1/health", get_health)
Bridge.provide("plantlens_descriptor", on_descriptor)
Bridge.provide("plantlens_sample", on_sample)

logger.info("PlantLens read-only gateway starting")
App.run()
