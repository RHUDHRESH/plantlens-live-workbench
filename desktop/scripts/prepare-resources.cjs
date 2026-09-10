const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const out = path.join(root, 'desktop', 'dist-resources');
const standalone = path.join(root, '.next', 'standalone');
if (!fs.existsSync(path.join(standalone, 'server.js'))) {
  throw new Error('Missing .next/standalone/server.js. Set output: "standalone" in next.config.ts and run the root build first.');
}
const leakedEnvironment = [];
for (const entry of fs.readdirSync(standalone, { recursive: true, withFileTypes: true })) {
  if (entry.isFile() && /^\.env(?:\.|$)/i.test(entry.name)) leakedEnvironment.push(path.join(entry.parentPath || entry.path, entry.name));
}
if (leakedEnvironment.length) throw new Error(`Refusing to package environment files: ${leakedEnvironment.join(', ')}`);
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.cpSync(standalone, path.join(out, 'app-server'), { recursive: true });
fs.cpSync(path.join(root, 'public'), path.join(out, 'app-server', 'public'), { recursive: true });
fs.cpSync(path.join(root, '.next', 'static'), path.join(out, 'app-server', '.next', 'static'), { recursive: true });
fs.cpSync(path.join(root, 'companion'), path.join(out, 'companion'), { recursive: true });
const llamaRuntime = path.join(root, '.cache', 'llama', 'bin');
if (!fs.existsSync(llamaRuntime)) throw new Error('Missing pinned llama.cpp runtime at .cache/llama/bin');
fs.cpSync(llamaRuntime, path.join(out, 'runtime'), { recursive: true });
