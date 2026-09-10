const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DesktopStore } = require('../store.cjs');
const { EvidenceTools, MAX_BYTES } = require('../evidence-tools.cjs');
const { ResearchTools, isPrivate } = require('../research-tools.cjs');
test('malformed provider root is blocked, not an uncaught exception', async () => {
  const research = new ResearchTools({ apiKey: 'synthetic-test-key', fetchImpl: async () => new Response('null') });
  assert.equal((await research.search({ query: 'synthetic manual', approved: true })).status, 'BLOCKED');
});
test('provider credentials cannot follow redirects and query does not carry workspace data', async () => {
  let called = false;
  const research = new ResearchTools({ apiKey: 'synthetic-test-key', fetchImpl: async (url, options) => {
    called = true; assert.equal(options.redirect, 'error');
    assert.deepEqual([...url.searchParams.keys()].sort(), ['count', 'q']);
    return new Response(JSON.stringify({ web: { results: [] } }));
  } });
  assert.equal((await research.search({ query: 'synthetic manual', approved: true })).status, 'OK');
  assert.equal(called, true);
});

function setup(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plantlens-evidence-')); const store = new DesktopStore(path.join(dir, 'db.sqlite')); t.after(() => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); }); return new EvidenceTools(store); }
test('imports, chunks, searches and reads local evidence', t => { const tools = setup(t); const added = tools.import({ name: 'drive.md', text: 'Safety limit is 42 rpm.\n'.repeat(200) }); assert.ok(added.chunkCount > 1); const hits = tools.search({ query: '" OR * limit', limit: 5 }); assert.ok(hits.length); assert.equal(tools.read(hits[0].excerptId).evidenceId, added.id); });
test('deduplicates normalized content by hash', t => { const tools = setup(t); const a = tools.import({ name: 'a.txt', text: 'same\r\ntext' }); const b = tools.import({ name: 'b.txt', text: 'same\ntext' }); assert.equal(b.id, a.id); assert.equal(b.duplicate, true); assert.equal(tools.list().length, 1); });
test('rejects bounds, paths, malformed json and PDF', t => { const tools = setup(t); assert.throws(() => tools.import({ name: '../x.txt', text: 'x' })); assert.throws(() => tools.import({ name: 'x.txt', text: 'x'.repeat(MAX_BYTES + 1) })); assert.throws(() => tools.import({ name: 'x.json', text: '{' })); assert.throws(() => tools.import({ name: 'x.pdf', mime: 'application/pdf', text: 'x' }), /PDF/); assert.throws(() => tools.search({ query: 'x'.repeat(301) })); });
test('research requires per-query consent and configured provider', async () => { const research = new ResearchTools({ apiKey: '', evidenceTools: {} }); assert.equal((await research.search({ query: 'motor', approved: false })).reason, 'CONSENT_REQUIRED'); assert.equal((await research.search({ query: 'motor', approved: true })).reason, 'PROVIDER_NOT_CONFIGURED'); });
test('private address classifications cover local ranges', () => { for (const ip of ['127.0.0.1', '10.1.2.3', '169.254.1.1', '172.16.0.1', '192.168.1.1', '::1', 'fd00::1']) assert.equal(isPrivate(ip), true, ip); assert.equal(isPrivate('8.8.8.8'), false); });
test('blocks mapped IPv6 and alternate private spellings', () => {
  for (const ip of ['::ffff:172.16.1.1', '::ffff:169.254.1.1', '::ffff:100.64.1.1', '::ffff:ac10:101', '0:0:0:0:0:0:0:1', 'ff02::1', '2002:7f00:1::', 'not-an-address']) assert.equal(isPrivate(ip), true, ip);
  assert.equal(isPrivate('2606:4700:4700::1111'), false);
});
