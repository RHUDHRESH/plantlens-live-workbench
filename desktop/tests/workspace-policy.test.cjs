const test = require('node:test');
const assert = require('node:assert/strict');
const { validateWorkspace } = require('../workspace-policy.cjs');

function valid() {
  return {
    schemaVersion: 1, id: 'CAD-1', name: 'Test cell', revision: 1,
    assets: [
      { id: 'SRC', name: 'Source', kind: 'sensor', description: 'Source', terminalIds: ['T-OUT'] },
      { id: 'DST', name: 'Destination', kind: 'controller', description: 'Destination', terminalIds: ['T-IN'] },
    ],
    terminals: [
      { id: 'T-OUT', assetId: 'SRC', name: 'Output', direction: 'out', signalType: 'analog', unit: 'bar' },
      { id: 'T-IN', assetId: 'DST', name: 'Input', direction: 'in', signalType: 'analog', unit: 'bar' },
    ],
    placements: [{ assetId: 'SRC', view: 'signal', x: 1.5, y: -2 }],
    connections: [{ id: 'C-1', view: 'signal', sourceTerminalId: 'T-OUT', targetTerminalId: 'T-IN', signalType: 'analog', unit: 'bar', verification: 'UNVERIFIED' }],
    proposals: [{ id: 'P-1', request: 'Rename SRC', source: 'LOCAL_MODEL', status: 'READY', baseRevision: 1, createdAt: '2026-09-10T00:00:00.000Z', changes: [{ id: 'PC-1', kind: 'rename_asset', assetId: 'SRC', value: 'Pressure source', summary: 'Rename source', status: 'PENDING' }] }],
  };
}

test('accepts a strict, referentially valid CAD workspace', () => assert.equal(validateWorkspace(valid()).id, 'CAD-1'));
test('approved add-asset history remains saveable while pending duplicate IDs are rejected', () => {
  const doc = valid();
  doc.assets.push({ id: 'NEW-1', name: 'Motor', kind: 'motor', description: 'Proposed motor', terminalIds: [] });
  doc.proposals[0].status = 'COMPLETED';
  doc.proposals[0].changes = [{ id: 'ADD-1', kind: 'add_asset', value: JSON.stringify({ id: 'NEW-1', name: 'Motor', kind: 'motor' }), summary: 'Add motor', status: 'APPROVED' }];
  assert.equal(validateWorkspace(doc).assets.length, 3);
  doc.proposals[0].changes[0].status = 'PENDING';
  assert.throws(() => validateWorkspace(doc), /duplicate/);
});

test('rejects unknown fields, malformed and duplicate IDs, and unbounded data', () => {
  assert.throws(() => validateWorkspace({ ...valid(), shell: 'calc' }), /unknown field/);
  const duplicate = valid(); duplicate.assets[1].id = 'SRC'; assert.throws(() => validateWorkspace(duplicate), /duplicate asset ID/);
  const oversized = valid(); oversized.name = 'x'.repeat(201); assert.throws(() => validateWorkspace(oversized), /1-200/);
});

test('rejects dangling ownership and non-finite placements', () => {
  const dangling = valid(); dangling.terminals[0].assetId = 'MISSING'; assert.throws(() => validateWorkspace(dangling), /ownership/);
  const coordinate = valid(); coordinate.placements[0].x = Infinity; assert.throws(() => validateWorkspace(coordinate), /coordinates/);
});

test('rejects incompatible connection types, directions, units, and electrical signals', () => {
  const direction = valid(); direction.terminals[0].direction = 'in'; assert.throws(() => validateWorkspace(direction), /directions/);
  const unit = valid(); unit.terminals[1].unit = 'V'; assert.throws(() => validateWorkspace(unit), /units/);
  const electrical = valid(); electrical.connections[0].view = 'electrical'; assert.throws(() => validateWorkspace(electrical), /not electrical/);
});

test('validates proposal revisions, statuses, operations, references, and structured values', () => {
  const staleFuture = valid(); staleFuture.proposals[0].baseRevision = 2; assert.throws(() => validateWorkspace(staleFuture), /baseRevision/);
  const bypass = valid(); bypass.proposals[0].changes[0].status = 'AUTHORIZED'; assert.throws(() => validateWorkspace(bypass), /change.status/);
  const operation = valid(); operation.proposals[0].changes[0].kind = 'write_register'; assert.throws(() => validateWorkspace(operation), /operation/);
  const missing = valid(); missing.proposals[0].changes[0].assetId = 'NONE'; assert.throws(() => validateWorkspace(missing), /unknown asset/);
  const add = valid(); add.proposals[0].changes[0] = { id: 'PC-1', kind: 'add_asset', value: JSON.stringify({ id: 'NEW-1', kind: 'motor', name: 'Motor', command: 'run' }), summary: 'Add motor', status: 'PENDING' }; assert.throws(() => validateWorkspace(add), /unknown field/);
});
