// Explicit developer acceptance check; never exposed through renderer IPC.
const path = require('node:path');
const fs = require('node:fs/promises');
const { ModelManager } = require('../model-manager.cjs');
const { InferenceService } = require('../inference.cjs');
const { DesktopStore } = require('../store.cjs');
const { EvidenceTools } = require('../evidence-tools.cjs');

async function main() {
  const root = path.resolve(__dirname, '../..');
  const dataDir = process.env.PLANTLENS_SMOKE_DATA || path.join(root, '.cache', 'model-smoke');
  const runtimeDir = path.join(root, '.cache', 'llama', 'bin');
  const manager = new ModelManager({ dataDir, runtimeDir });
  await manager.ready;
  if (manager.status().state !== 'READY') {
    const source = process.env.PLANTLENS_SMOKE_SOURCE || path.join(root, '.cache', 'llama', manager.manifest.source.filename);
    try { await fs.link(source, manager.sourcePath); } catch (error) { if (error.code !== 'EEXIST') await fs.copyFile(source, manager.sourcePath); }
    console.log('Optimizing checksum-verified official source…');
    await manager.install();
  }
  if (manager.status().state !== 'READY') throw new Error(manager.status().error);
  const store = new DesktopStore(path.join(dataDir, 'smoke.sqlite3'));
  const service = new InferenceService({ modelManager: manager, runtimeDir, store });
  const evidence = new EvidenceTools(store).import({ name: 'smoke-motor-context.txt', text: 'Asset M-101 is the cooling pump motor. This note supports an equipment name only, not wiring or register assignments.' });
  const started = Date.now();
  try {
    const proposal = await service.draft('Rename asset M-101 to Cooling pump motor.', { revision: 1, assets: [{ id: 'M-101', name: 'Process motor', kind: 'motor' }] });
    if (proposal.changes.length !== 1 || proposal.changes[0].kind !== 'rename_asset' || proposal.changes[0].assetId !== 'M-101') throw new Error('Unexpected draft outcome.');
    if (!store.checkpointGet(proposal.id)) throw new Error('Checkpoint was not persisted.');
    if (!proposal.citations?.some(citation => citation.evidenceId === evidence.id)) throw new Error('Local retrieval provenance was not attached to the draft.');
    console.log(JSON.stringify({ elapsedMs: Date.now() - started, proposal, model: manager.status(), inferencePid: service.process?.pid }, null, 2));
  } finally { service.unload(); store.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
