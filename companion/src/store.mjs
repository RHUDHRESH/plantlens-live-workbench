import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";

export class CompanionStore {
  constructor(path) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY,
        occurred_at INTEGER NOT NULL,
        actor TEXT NOT NULL,
        kind TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        detail_json TEXT NOT NULL,
        previous_hash TEXT NOT NULL,
        event_hash TEXT NOT NULL UNIQUE
      );
      CREATE TABLE IF NOT EXISTS telemetry_rollups (
        device_uuid TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        bucket_ms INTEGER NOT NULL,
        minimum REAL,
        maximum REAL,
        average REAL,
        last_value REAL,
        sample_count INTEGER NOT NULL,
        worst_quality TEXT NOT NULL,
        PRIMARY KEY(device_uuid, channel_id, bucket_ms)
      );
      CREATE TABLE IF NOT EXISTS config_versions (
        id TEXT PRIMARY KEY,
        version INTEGER NOT NULL UNIQUE,
        status TEXT NOT NULL CHECK(status IN ('ACTIVE','SUPERSEDED')),
        created_at INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        payload_hash TEXT NOT NULL UNIQUE
      );
    `);
  }

  appendAudit({ actor, kind, subjectId, detail }) {
    const prior = this.db.prepare("SELECT event_hash FROM audit_events ORDER BY occurred_at DESC, id DESC LIMIT 1").get();
    const event = {
      id: randomUUID(),
      occurredAt: Date.now(),
      actor,
      kind,
      subjectId,
      detail,
      previousHash: prior?.event_hash ?? "GENESIS",
    };
    const eventHash = createHash("sha256").update(JSON.stringify(event)).digest("hex");
    this.db.prepare(`INSERT INTO audit_events
      (id, occurred_at, actor, kind, subject_id, detail_json, previous_hash, event_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(event.id, event.occurredAt, actor, kind, subjectId, JSON.stringify(detail), event.previousHash, eventHash);
    return { ...event, eventHash };
  }

  listAudit(limit = 100) {
    return this.db.prepare("SELECT * FROM audit_events ORDER BY occurred_at DESC, id DESC LIMIT ?").all(Math.min(500, Math.max(1, limit)));
  }

  close() {
    this.db.close();
  }
}

