const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const childProcess = require('node:child_process');

// ModelManager intentionally does not expose process injection. Replace spawn before
// loading it with a deterministic quantizer double which copies source to output.
const originalSpawn = childProcess.spawn;
childProcess.spawn = (_executable, args) => {
  const child = new EventEmitter();
  child.stderr = new EventEmitter();
  process.nextTick(async () => {
    try { await fs.copyFile(args[1], args[2]); child.emit('exit', 0); }
    catch (error) { child.emit('error', error); }
  });
  return child;
};
delete require.cache[require.resolve('../model-manager.cjs')];
const { ModelManager } = require('../model-manager.cjs');
childProcess.spawn = originalSpawn;

const payload = Buffer.from('small deterministic model artifact');
const digest = crypto.createHash('sha256').update(payload).digest('hex');
const manifest = {
  schemaVersion: 1, id: 'test_model', name: 'Test model', license: 'test-only', minimumFreeDiskBytes: 1,
  source: { url: 'https://huggingface.co/test/model.bin', filename: 'source.gguf', sha256: digest, bytes: payload.length },
  runtime: { url: 'https://github.com/test/runtime.zip', filename: 'runtime.zip', sha256: 'b'.repeat(64), bytes: 1, version: 'test-runtime' },
  conversion: { filename: 'model-q4.gguf', provenance: 'test', quantization: 'Q4_K_M' },
};

function response(bytes, { status = 200, contentRange } = {}) {
  return {
    ok: true, status,
    headers: { get: name => name.toLowerCase() === 'content-range' ? (contentRange ?? null) : null },
    body: new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }),
  };
}

async function managerWith(fetchImpl) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plantlens-model-test-'));
  const runtimeDir = path.join(root, 'runtime');
  await fs.mkdir(runtimeDir);
  const manager = new ModelManager({ dataDir: root, runtimeDir, manifest, fetchImpl });
  manager.preflight = async () => {};
  await manager.ready;
  return { manager, root };
}

test('first-run download verifies and installs the pinned quantization', async t => {
  const { manager, root } = await managerWith(async () => response(payload));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const result = await manager.install();
  assert.equal(result.state, 'READY');
  assert.equal(await fs.readFile(manager.modelPath, 'utf8'), payload.toString());
  assert.equal((await fs.stat(manager.partialPath).catch(() => null)), null);
});

test('an interrupted partial download is resumed with a validated Range response', async t => {
  const split = 9;
  let first = true;
  const ranges = [];
  const fetchImpl = async (_url, options) => {
    ranges.push(options.headers.Range ?? null);
    if (first) {
      first = false;
      // Simulate a connection which ended cleanly at the HTTP layer before all
      // manifest bytes arrived; verification must retain the resumable partial.
      return response(payload.subarray(0, split));
    }
    return response(payload.subarray(split), { status: 206, contentRange: `bytes ${split}-${payload.length - 1}/${payload.length}` });
  };
  const firstRun = await managerWith(fetchImpl);
  t.after(() => fs.rm(firstRun.root, { recursive: true, force: true }));
  assert.equal((await firstRun.manager.install()).state, 'ERROR');
  assert.equal((await fs.stat(firstRun.manager.partialPath)).size, split);

  const resumed = new ModelManager({ dataDir: firstRun.root, runtimeDir: firstRun.manager.runtimeDir, manifest, fetchImpl });
  resumed.preflight = async () => {};
  await resumed.ready;
  assert.equal(resumed.status().state, 'PAUSED');
  assert.equal((await resumed.install()).state, 'READY');
  assert.deepEqual(ranges, [null, `bytes=${split}-`]);
});

test('checksum mismatch is actionable and never promotes the partial artifact', async t => {
  const corrupt = Buffer.from(payload); corrupt[0] ^= 0xff;
  const { manager, root } = await managerWith(async () => response(corrupt));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const result = await manager.install();
  assert.equal(result.state, 'ERROR');
  assert.match(result.error, /checksum verification failed/i);
  await assert.rejects(fs.access(manager.sourcePath));
  assert.equal((await fs.stat(manager.partialPath)).size, payload.length);
});

test('cancel aborts an in-flight first launch and removes only incomplete artifacts', async t => {
  let controller;
  const hanging = new ReadableStream({ start(value) { controller = value; value.enqueue(payload.subarray(0, 5)); } });
  const { manager, root } = await managerWith(async () => ({ ok: true, status: 200, headers: { get: () => null }, body: hanging }));
  t.after(() => { try { controller.close(); } catch {} return fs.rm(root, { recursive: true, force: true }); });
  const installing = manager.install();
  while (manager.status().downloadedBytes < 5) await new Promise(resolve => setImmediate(resolve));
  const result = await manager.cancel();
  await installing;
  assert.equal(result.state, 'NOT_INSTALLED');
  assert.equal(result.downloadedBytes, 0);
  await assert.rejects(fs.access(manager.partialPath));
});
