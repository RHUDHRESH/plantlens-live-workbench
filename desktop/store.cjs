const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const now = () => new Date().toISOString();
const json = (value) => JSON.stringify(value ?? null);
const parse = (value) => value == null ? null : JSON.parse(value);

class RevisionConflictError extends Error {
  constructor(expected, actual) {
    super(`Workspace revision conflict: expected ${expected}, current revision is ${actual}`);
    this.name = 'RevisionConflictError';
    this.code = 'REVISION_CONFLICT';
    this.actualRevision = actual;
  }
}

class DesktopStore {
  constructor(filename) {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA foreign_keys=ON;
      PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS workspace_revisions (
        revision INTEGER PRIMARY KEY AUTOINCREMENT,
        document_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS preferences (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS model_installation (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        state_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS agent_checkpoints (
        id TEXT PRIMARY KEY,
        workspace_revision INTEGER NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('blocked','skipped','completed','failed','pending')),
        checkpoint_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS proposals (
        id TEXT PRIMARY KEY,
        checkpoint_id TEXT,
        base_revision INTEGER NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending','partially-approved','approved','rejected','failed')),
        proposal_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(checkpoint_id) REFERENCES agent_checkpoints(id)
      );
      CREATE TABLE IF NOT EXISTS approvals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        proposal_id TEXT NOT NULL,
        item_id TEXT NOT NULL,
        approved_json TEXT NOT NULL,
        approved_at TEXT NOT NULL,
        UNIQUE(proposal_id, item_id),
        FOREIGN KEY(proposal_id) REFERENCES proposals(id)
      );
      CREATE TABLE IF NOT EXISTS manuals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_id TEXT NOT NULL,
        title TEXT NOT NULL,
        page INTEGER,
        content TEXT NOT NULL,
        provenance_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS manuals_fts USING fts5(title, content, content='manuals', content_rowid='id');
      CREATE TRIGGER IF NOT EXISTS manuals_ai AFTER INSERT ON manuals BEGIN
        INSERT INTO manuals_fts(rowid,title,content) VALUES(new.id,new.title,new.content);
      END;
      CREATE TRIGGER IF NOT EXISTS manuals_ad AFTER DELETE ON manuals BEGIN
        INSERT INTO manuals_fts(manuals_fts,rowid,title,content) VALUES('delete',old.id,old.title,old.content);
      END;
    `);
  }

  workspaceLoad() {
    const row = this.db.prepare('SELECT revision, document_json, created_at FROM workspace_revisions ORDER BY revision DESC LIMIT 1').get();
    return row ? { revision: row.revision, document: parse(row.document_json), savedAt: row.created_at } : { revision: 0, document: null, savedAt: null };
  }

  workspaceSave(document, expectedRevision) {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new TypeError('expectedRevision must be a non-negative integer');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const current = this.db.prepare('SELECT COALESCE(MAX(revision), 0) AS revision FROM workspace_revisions').get().revision;
      if (current !== expectedRevision) throw new RevisionConflictError(expectedRevision, current);
      const assignedRevision = current + 1;
      const normalized = {
        ...document,
        revision: assignedRevision,
        proposals: Array.isArray(document.proposals) ? document.proposals.map((proposal) =>
          proposal?.status === 'READY' && proposal.baseRevision === document.revision ? { ...proposal, baseRevision: assignedRevision } : proposal) : document.proposals,
      };
      const serialized = json(normalized);
      if (Buffer.byteLength(serialized) > 16 * 1024 * 1024) throw new RangeError('Workspace document exceeds 16 MiB');
      const createdAt = now();
      const result = this.db.prepare('INSERT INTO workspace_revisions(document_json,created_at) VALUES(?,?)').run(serialized, createdAt);
      this.db.exec('COMMIT');
      return { revision: Number(result.lastInsertRowid), document: normalized, savedAt: createdAt };
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  workspaceHistory(limit = 25) {
    return this.db.prepare('SELECT revision, created_at FROM workspace_revisions ORDER BY revision DESC LIMIT ?').all(Math.max(1, Math.min(100, limit))).map((row) => ({ ...row }));
  }

  preferenceGet(key, fallback = null) {
    const row = this.db.prepare('SELECT value_json FROM preferences WHERE key=?').get(key);
    return row ? parse(row.value_json) : fallback;
  }

  preferenceSet(key, value) {
    this.db.prepare(`INSERT INTO preferences(key,value_json,updated_at) VALUES(?,?,?)
      ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at`).run(key, json(value), now());
  }

  modelStateGet() {
    const row = this.db.prepare('SELECT state_json FROM model_installation WHERE id=1').get();
    return row ? parse(row.state_json) : null;
  }

  modelStateSet(state) {
    this.db.prepare(`INSERT INTO model_installation(id,state_json,updated_at) VALUES(1,?,?)
      ON CONFLICT(id) DO UPDATE SET state_json=excluded.state_json,updated_at=excluded.updated_at`).run(json(state), now());
  }

  checkpointSave(checkpoint) {
    const stamp = now();
    this.db.prepare(`INSERT INTO agent_checkpoints(id,workspace_revision,state,checkpoint_json,created_at,updated_at) VALUES(?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET state=excluded.state,checkpoint_json=excluded.checkpoint_json,updated_at=excluded.updated_at`)
      .run(checkpoint.id, checkpoint.workspaceRevision, checkpoint.state, json(checkpoint), stamp, stamp);
  }

  checkpointGet(id) {
    const row = this.db.prepare('SELECT checkpoint_json FROM agent_checkpoints WHERE id=?').get(id);
    return row ? parse(row.checkpoint_json) : null;
  }

  proposalSave(proposal) {
    const stamp = now();
    this.db.prepare(`INSERT INTO proposals(id,checkpoint_id,base_revision,status,proposal_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET status=excluded.status,proposal_json=excluded.proposal_json,updated_at=excluded.updated_at`)
      .run(proposal.id, proposal.checkpointId ?? null, proposal.baseRevision, proposal.status ?? 'pending', json(proposal), stamp, stamp);
  }

  approvalSave(proposalId, itemId, approved) {
    this.db.prepare('INSERT INTO approvals(proposal_id,item_id,approved_json,approved_at) VALUES(?,?,?,?)')
      .run(proposalId, itemId, json(approved), now());
  }

  manualAdd({ sourceId, title, page = null, content, provenance = {} }) {
    return Number(this.db.prepare('INSERT INTO manuals(source_id,title,page,content,provenance_json,created_at) VALUES(?,?,?,?,?,?)')
      .run(sourceId, title, page, content, json(provenance), now()).lastInsertRowid);
  }

  manualSearch(query, limit = 8) {
    if (typeof query !== 'string' || !query.trim()) return [];
    const terms = query.match(/[\p{L}\p{N}_-]+/gu)?.slice(0, 16) || [];
    if (!terms.length) return [];
    const expression = terms.map((term) => `"${term.replaceAll('"', '""')}"`).join(' OR ');
    return this.db.prepare(`SELECT m.source_id AS sourceId,m.title,m.page,
      snippet(manuals_fts,1,'[',']',' … ',24) AS excerpt,m.provenance_json AS provenance
      FROM manuals_fts JOIN manuals m ON m.id=manuals_fts.rowid WHERE manuals_fts MATCH ? ORDER BY rank LIMIT ?`)
      .all(expression, Math.max(1, Math.min(25, limit))).map((row) => ({ ...row, provenance: parse(row.provenance), provenance_json: undefined }));
  }

  searchManuals(query, limit) { return this.manualSearch(query, limit); }

  saveCheckpoint(runId, payload) {
    const normalized = String(payload?.status || 'pending').toLowerCase().replace('awaiting_review', 'pending');
    const state = ['blocked', 'skipped', 'completed', 'failed', 'pending'].includes(normalized) ? normalized : 'pending';
    this.checkpointSave({ ...payload, id: runId, workspaceRevision: Number(payload?.baseRevision || 0), state });
  }

  close() { this.db.close(); }
}

module.exports = { DesktopStore, RevisionConflictError };
