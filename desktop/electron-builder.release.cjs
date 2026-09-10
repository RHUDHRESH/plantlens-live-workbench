const base = require('./electron-builder.base.cjs');
if (!process.env.CSC_LINK) throw new Error('CSC_LINK is required for a signed public release');
if (!process.env.CSC_KEY_PASSWORD) throw new Error('CSC_KEY_PASSWORD is required for a signed public release');
if (!process.env.PLANTLENS_MODEL_MANIFEST_PUBLIC_KEY) throw new Error('PLANTLENS_MODEL_MANIFEST_PUBLIC_KEY is required for signed manifest verification');
const manifest = require('./model-manifest.json');
if (!manifest.releaseSignature) throw new Error('model-manifest.json must contain a releaseSignature for public builds');
module.exports = {
  ...base,
  extraMetadata: { plantlensSignedRelease: true, plantlensReleasePublicKey: process.env.PLANTLENS_MODEL_MANIFEST_PUBLIC_KEY },
  win: { ...base.win, signAndEditExecutable: true },
};
