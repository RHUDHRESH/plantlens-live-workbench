"""Dependency-free PlantLens/1 validation shared by gateway tests and App Lab."""
import hashlib
import json
import re

UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", re.I)
SHA256 = re.compile(r"^[0-9a-f]{64}$", re.I)

def stable_hash(value):
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return hashlib.sha256(encoded.encode()).hexdigest()

def validate_descriptor(value):
    if not isinstance(value, dict) or value.get("magic") != "PLANTLENS/1":
        raise ValueError("Not a PlantLens/1 descriptor")
    if value.get("protocol", {}).get("major") != 1:
        raise ValueError("Unsupported protocol major")
    if not UUID.match(str(value.get("deviceUuid", ""))) or not SHA256.match(str(value.get("firmwareHash", ""))):
        raise ValueError("Invalid durable identity")
    channels = value.get("channels")
    if value.get("writesSupported") is not False or not isinstance(channels, list) or len(channels) > 128:
        raise ValueError("Descriptor is not bounded read-only telemetry")
    ids = [item.get("id") for item in channels if isinstance(item, dict)]
    if len(ids) != len(channels) or len(set(ids)) != len(ids) or any(not item or len(item) > 80 for item in ids):
        raise ValueError("Invalid channel identifiers")
    if any(item.get("access") != "READ_ONLY" for item in channels):
        raise ValueError("Writable channel")
    if value.get("channelCount") != len(channels) or value.get("schemaHash") != stable_hash(channels):
        raise ValueError("Channel count or schema hash mismatch")
    return value
