const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DesktopStore } = require('../store.cjs');

const stores = [];
function makeStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plantlens-store-'));
  const store = new DesktopStore(path.join(dir, 'state.sqlite3'));
  stores.push({ store, dir });
  return store;
}
afterEach(() => { while (stores.length) { const { store, dir } = stores.pop(); store.close(); fs.rmSync(dir, { recursive: true, force: true }); } });

test('workspace revisions are immutable and reject stale writes', () => {
  const store = makeStore();
  assert.equal(store.workspaceLoad().revision, 0);
  assert.equal(store.workspaceSave({ revision: 99, assets: [{ id: 'motor-1' }] }, 0).revision, 1);
  assert.throws(() => store.workspaceSave({ revision: 99, assets: [] }, 0), { code: 'REVISION_CONFLICT' });
  assert.deepEqual(store.workspaceLoad().document.assets, [{ id: 'motor-1' }]);
  assert.deepEqual(store.workspaceHistory(), [{ revision: 1, created_at: store.workspaceLoad().savedAt }]);
});

test('saving rebases only current review proposals onto the assigned durable revision', () => {
  const store = makeStore();
  const saved = store.workspaceSave({ revision: 5, assets: [], proposals: [
    { id: 'current', status: 'READY', baseRevision: 5 },
    { id: 'stale', status: 'READY', baseRevision: 4 },
  ] }, 0).document;
  assert.equal(saved.revision, 1);
  assert.equal(saved.proposals[0].baseRevision, 1);
  assert.equal(saved.proposals[1].baseRevision, 4);
});

test('manual excerpts are retrieved locally with provenance', () => {
  const store = makeStore();
  store.manualAdd({ sourceId: 'manual-vfd', title: 'Drive manual', page: 12, content: 'The DC bus terminal must not be used as a telemetry source.', provenance: { sha256: 'abc' } });
  const hits = store.manualSearch('telemetry');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].sourceId, 'manual-vfd');
  assert.deepEqual(hits[0].provenance, { sha256: 'abc' });
});

test('preferences and checkpoints survive reopening', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plantlens-store-'));
  let store = new DesktopStore(path.join(dir, 'state.sqlite3'));
  store.preferenceSet('backgroundMonitoring', true);
  store.checkpointSave({ id: 'run-1', workspaceRevision: 0, state: 'pending' });
  store.close();
  store = new DesktopStore(path.join(dir, 'state.sqlite3'));
  assert.equal(store.preferenceGet('backgroundMonitoring'), true);
  assert.equal(store.checkpointGet('run-1').state, 'pending');
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
