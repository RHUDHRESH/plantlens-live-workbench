const { createHash, verify } = require('node:crypto');
const { createReadStream, createWriteStream, existsSync } = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { pipeline } = require('node:stream/promises');
const { Readable, Transform } = require('node:stream');
const defaultManifest = require('./model-manifest.json');

async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

function validateManifest(manifest, { requireSignature = false, publicKey } = {}) {
  if (manifest.schemaVersion !== 1 || !/^[a-z0-9][a-z0-9._-]{0,79}$/.test(manifest.id) || manifest.id.includes('..')) throw new Error('Unsupported model manifest.');
  for (const artifact of [manifest.source, manifest.runtime]) {
    const url = new URL(artifact.url);
    if (url.protocol !== 'https:' || !['huggingface.co', 'github.com'].includes(url.hostname)) throw new Error('Untrusted artifact source.');
    if (!/^[a-f0-9]{64}$/.test(artifact.sha256) || !Number.isSafeInteger(artifact.bytes) || artifact.bytes < 1) throw new Error('Invalid artifact checksum or size.');
  }
  if (path.basename(manifest.source.filename) !== manifest.source.filename || path.basename(manifest.conversion.filename) !== manifest.conversion.filename) throw new Error('Invalid model filename.');
  if (requireSignature || manifest.releaseSignature) {
    if (!publicKey || !manifest.releaseSignature) throw new Error('A signed release manifest and trusted public key are required.');
    const unsigned = { ...manifest, releaseSignature: null };
    if (!verify(null, Buffer.from(JSON.stringify(unsigned)), publicKey, Buffer.from(manifest.releaseSignature, 'base64'))) throw new Error('Invalid release manifest signature.');
  }
  return manifest;
}

class ModelManager {
  constructor({ dataDir, runtimeDir, manifest = defaultManifest, fetchImpl = fetch, requireSignature = false, publicKey } = {}) {
    this.manifest = validateManifest(manifest, { requireSignature, publicKey });
    this.directory = path.join(dataDir, 'models', manifest.id);
    this.runtimeDir = runtimeDir;
    this.fetch = fetchImpl;
    this.state = { state: 'NOT_INSTALLED', downloadedBytes: 0, totalBytes: manifest.source.bytes, error: null };
    this.controller = null;
    this.active = null;
    this.quantizer = null;
    this.ready = this.restore();
  }
  get modelPath() { return path.join(this.directory, this.manifest.conversion.filename); }
  get sourcePath() { return path.join(this.directory, this.manifest.source.filename); }
  get partialPath() { return `${this.sourcePath}.partial`; }
  async restore() {
    await fs.mkdir(this.directory, { recursive: true });
    try {
      const receipt = JSON.parse(await fs.readFile(path.join(this.directory, 'receipt.json'), 'utf8'));
      if (receipt.sourceSha256 === this.manifest.source.sha256 && receipt.runtimeVersion === this.manifest.runtime.version && /^[a-f0-9]{64}$/.test(receipt.sha256)) {
        this.state.state = 'VERIFYING';
        if (await sha256(this.modelPath) === receipt.sha256) { this.state.state = 'READY'; return; }
      }
    } catch { /* Missing or incomplete installations can be resumed. */ }
    this.state.state = 'NOT_INSTALLED';
    this.state.downloadedBytes = (await fs.stat(this.partialPath).catch(() => ({ size: 0 }))).size;
    if (this.state.downloadedBytes) this.state.state = 'PAUSED';
  }
  status() {
    return { ...this.state, id: this.manifest.id, name: this.manifest.name, contextTokens: 4096, requiresNetwork: this.state.state !== 'READY', license: this.manifest.license, signedRelease: !!this.manifest.releaseSignature, provenance: this.manifest.conversion.provenance };
  }
  async preflight() {
    await fs.mkdir(this.directory, { recursive: true });
    if (process.arch !== 'x64') throw new Error('This release requires an x64 CPU.');
    if (os.totalmem() < 7 * 1024 ** 3) throw new Error('Local AI requires an 8 GB PC. Manual workflows remain available.');
    const disk = await fs.statfs(this.directory);
    if (disk.bavail * disk.bsize < this.manifest.minimumFreeDiskBytes) throw new Error('Free at least 4 GB for model setup.');
    await fs.access(this.runtimeDir);
  }
  async install() {
    await this.ready;
    if (this.active) return this.active;
    if (this.state.state === 'READY') return this.status();
    this.controller = new AbortController();
    this.state.error = null;
    this.active = this.performInstall(this.controller.signal).catch(error => {
      if (this.state.state !== 'PAUSED') this.state = { ...this.state, state: 'ERROR', error: error.message };
      return this.status();
    }).finally(() => { this.active = null; this.controller = null; });
    return this.active;
  }
  async performInstall(signal) {
    await this.preflight();
    let sourceVerified = false;
    if (existsSync(this.sourcePath)) sourceVerified = await sha256(this.sourcePath) === this.manifest.source.sha256;
    if (!sourceVerified) {
      const start = (await fs.stat(this.partialPath).catch(() => ({ size: 0 }))).size;
      if (start > this.manifest.source.bytes) throw new Error('Partial model is larger than its manifest. Cancel setup and retry.');
      this.state.state = 'DOWNLOADING';
      this.state.downloadedBytes = start;
      if (start < this.manifest.source.bytes) {
        const response = await this.fetch(this.manifest.source.url, { headers: start ? { Range: `bytes=${start}-` } : {}, signal });
        if (!response.ok || !response.body) throw new Error(`Model download failed: HTTP ${response.status}.`);
        const resumed = response.status === 206;
        if (resumed && !response.headers.get('content-range')?.startsWith(`bytes ${start}-`)) throw new Error('Invalid resume response.');
        this.state.downloadedBytes = resumed ? start : 0;
        const counter = new Transform({ transform: (chunk, encoding, callback) => {
          this.state.downloadedBytes += chunk.length;
          if (this.state.downloadedBytes > this.manifest.source.bytes) return callback(new Error('Download exceeds manifest size.'));
          callback(null, chunk);
        } });
        await pipeline(Readable.fromWeb(response.body), counter, createWriteStream(this.partialPath, { flags: resumed ? 'a' : 'w' }), { signal });
      }
      if (signal.aborted) throw new Error('Setup paused.');
      this.state.state = 'VERIFYING';
      if ((await fs.stat(this.partialPath)).size !== this.manifest.source.bytes || await sha256(this.partialPath) !== this.manifest.source.sha256) throw new Error('Model checksum verification failed. Cancel setup to discard the incomplete download.');
      await fs.rename(this.partialPath, this.sourcePath);
    }
    if (signal.aborted) throw new Error('Setup paused.');
    this.state.state = 'OPTIMIZING';
    const pending = `${this.modelPath}.pending`;
    await new Promise((resolve, reject) => {
      const child = spawn(path.join(this.runtimeDir, 'llama-quantize.exe'), ['--allow-requantize', this.sourcePath, pending, 'Q4_K_M', '2'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'], signal });
      this.quantizer = child;
      let detail = '';
      child.stderr.on('data', chunk => { detail = (detail + chunk.toString()).slice(-2000); });
      child.once('error', reject);
      child.once('exit', code => { this.quantizer = null; if (code === 0) resolve(); else reject(new Error(`Model optimization failed (${code}): ${detail}`)); });
    });
    const digest = await sha256(pending);
    await fs.rename(pending, this.modelPath);
    const receipt = { sourceSha256: this.manifest.source.sha256, runtimeVersion: this.manifest.runtime.version, sha256: digest, installedAt: new Date().toISOString() };
    const receiptPath = path.join(this.directory, 'receipt.json');
    await fs.writeFile(`${receiptPath}.pending`, JSON.stringify(receipt));
    await fs.rename(`${receiptPath}.pending`, receiptPath);
    this.state = { ...this.state, state: 'READY', downloadedBytes: this.manifest.source.bytes, error: null };
    return this.status();
  }
  pause() { if (this.active) { this.state.state = 'PAUSED'; this.controller?.abort(); } return this.status(); }
  async cancel() {
    this.pause();
    await this.active;
    // Remove only this manager's incomplete model artifacts; keep installed models and evidence.
    await fs.rm(this.partialPath, { force: true });
    await fs.rm(`${this.modelPath}.pending`, { force: true });
    if (this.state.state !== 'READY') this.state = { ...this.state, state: 'NOT_INSTALLED', downloadedBytes: 0, error: null };
    return this.status();
  }
}
module.exports = { ModelManager, validateManifest, sha256 };
