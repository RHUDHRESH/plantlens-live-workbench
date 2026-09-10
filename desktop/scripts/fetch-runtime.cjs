const { createHash } = require('node:crypto');
const { createWriteStream, existsSync, mkdirSync, renameSync, rmSync } = require('node:fs');
const { pipeline } = require('node:stream/promises');
const { Readable } = require('node:stream');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const manifest = require('../model-manifest.json');

(async () => {
  const root = path.resolve(__dirname, '..', '..');
  const cache = path.join(root, '.cache', 'llama');
  const destination = path.join(cache, 'bin');
  if (existsSync(path.join(destination, 'llama-server.exe')) && existsSync(path.join(destination, 'llama-quantize.exe'))) return;
  mkdirSync(cache, { recursive: true });
  const archive = path.join(cache, `llama-${manifest.runtime.version}.zip.partial`);
  const staging = path.join(cache, `extract-${process.pid}`);
  rmSync(staging, { recursive: true, force: true }); mkdirSync(staging);
  const response = await fetch(manifest.runtime.url);
  if (!response.ok || !response.body) throw new Error(`Runtime download failed (${response.status})`);
  let bytes = 0; const hash = createHash('sha256');
  await pipeline(Readable.fromWeb(response.body), async function* (source) { for await (const chunk of source) { bytes += chunk.length; hash.update(chunk); yield chunk; } }, createWriteStream(archive));
  if (bytes !== manifest.runtime.bytes || hash.digest('hex') !== manifest.runtime.sha256) { rmSync(archive, { force: true }); throw new Error('Pinned llama.cpp archive verification failed'); }
  const extracted = spawnSync('tar.exe', ['-xf', archive, '-C', staging], { windowsHide: true });
  if (extracted.status !== 0) throw new Error(`Runtime extraction failed: ${extracted.stderr?.toString()}`);
  const candidates = require('node:fs').readdirSync(staging, { recursive: true, withFileTypes: true });
  const server = candidates.find((entry) => entry.isFile() && entry.name === 'llama-server.exe');
  if (!server) throw new Error('Verified archive did not contain llama-server.exe');
  const runtimeRoot = server.parentPath || server.path;
  rmSync(destination, { recursive: true, force: true }); renameSync(runtimeRoot, destination);
  rmSync(staging, { recursive: true, force: true }); rmSync(archive, { force: true });
  process.stdout.write(`Installed verified llama.cpp ${manifest.runtime.version} at ${destination}\n`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
