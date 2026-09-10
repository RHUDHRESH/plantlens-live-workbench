const { createHash, randomUUID } = require('node:crypto');

const MAX_BYTES = 2 * 1024 * 1024;
const MIME = new Set(['text/plain', 'text/markdown', 'text/csv', 'application/json']);
const EXT = { txt: 'text/plain', md: 'text/markdown', markdown: 'text/markdown', csv: 'text/csv', json: 'application/json' };

function cleanName(name) {
  if (typeof name !== 'string' || !name.trim() || name.length > 180 || /[\\/\0]/.test(name)) throw new TypeError('name must be a plain filename (1-180 characters)');
  return name.trim();
}
function chunkText(text) {
  const chunks = [];
  for (let offset = 0; offset < text.length; offset += 1800) {
    let end = Math.min(text.length, offset + 2200);
    if (end < text.length) { const split = text.lastIndexOf('\n', end); if (split > offset + 900) end = split; }
    chunks.push(text.slice(offset, end)); offset = end - 1800;
  }
  return chunks.length ? chunks : [''];
}
class EvidenceTools {
  constructor(store) { this.store = store; }
  import(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !['name', 'text', 'mime'].includes(k))) throw new TypeError('Invalid evidence import');
    const name = cleanName(input.name);
    if (typeof input.text !== 'string') throw new TypeError('text must be a string');
    const bytes = Buffer.byteLength(input.text);
    if (!bytes || bytes > MAX_BYTES) throw new RangeError('Evidence must contain 1 byte to 2 MiB');
    const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
    const mime = input.mime || EXT[ext];
    if (!MIME.has(mime) || (ext === 'pdf') || !mime) throw new TypeError('Unsupported evidence type. Use TXT, Markdown, CSV, or JSON; PDF is not yet supported.');
    if (mime === 'application/json') { try { JSON.parse(input.text); } catch { throw new TypeError('JSON evidence is malformed'); } }
    const text = input.text.replaceAll('\0', '').replace(/\r\n?/g, '\n');
    const hash = createHash('sha256').update(text).digest('hex');
    const existing = this.store.evidenceFindByHash(hash);
    if (existing) return { ...existing, duplicate: true };
    return { ...this.store.evidenceAdd({ id: randomUUID(), hash, name, mime, content: text, chunks: chunkText(text) }), duplicate: false };
  }
  list() { return this.store.evidenceList(); }
  search(input) {
    const query = typeof input === 'string' ? input : input?.query;
    const limit = typeof input === 'object' ? input.limit : undefined;
    if (typeof query !== 'string' || !query.trim() || query.length > 300) throw new TypeError('query must contain 1-300 characters');
    return this.store.evidenceSearch(query, limit);
  }
  read(input) {
    const id = typeof input === 'string' ? input : input?.id;
    if (typeof id !== 'string' || !/^[\w:-]{1,100}$/.test(id)) throw new TypeError('Invalid evidence ID');
    return this.store.evidenceRead(id);
  }
}
module.exports = { EvidenceTools, MAX_BYTES, chunkText };
