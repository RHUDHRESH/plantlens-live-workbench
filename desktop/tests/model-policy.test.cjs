const test = require('node:test');
const assert = require('node:assert/strict');
const { validateManifest } = require('../model-manager.cjs');
const { validateDraft } = require('../inference.cjs');
const manifest = require('../model-manifest.json');
test('artifact policy rejects mutable untrusted sources and unsigned production manifests', () => {
  assert.equal(validateManifest(manifest).id, manifest.id);
  assert.throws(() => validateManifest({ ...manifest, source: { ...manifest.source, url: 'http://evil.test/model' } }));
  assert.throws(() => validateManifest(manifest, { requireSignature: true }));
});
test('model output cannot add unknown operations, duplicate IDs or arbitrary asset fields', () => {
  const doc = { assets: [{ id: 'MTR-01', name: 'Motor', kind: 'motor' }] };
  assert.doesNotThrow(() => validateDraft({ summary: 'Rename', changes: [{ kind: 'rename_asset', assetId: 'MTR-01', value: 'Pump motor', summary: 'Rename label' }] }, doc));
  for (const change of [
    { kind: 'write_register', value: '1', summary: 'Bad' },
    { kind: 'rename_asset', assetId: 'missing', value: 'Other', summary: 'Bad' },
    { kind: 'add_asset', value: JSON.stringify({ id: 'MTR-01', kind: 'motor', name: 'Duplicate' }), summary: 'Bad' },
    { kind: 'add_asset', value: JSON.stringify({ id: 'NEW', kind: 'motor', name: 'New', shell: 'anything' }), summary: 'Bad' },
  ]) assert.throws(() => validateDraft({ summary: 'Invalid', changes: [change] }, doc));
});
