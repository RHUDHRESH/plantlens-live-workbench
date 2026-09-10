const base = require('./electron-builder.base.cjs');
module.exports = {
  ...base,
  extraMetadata: { plantlensSignedRelease: false },
  productName: 'PlantLens (Unsigned Development Build)',
  win: { ...base.win, signAndEditExecutable: false, artifactName: 'PlantLens-Unsigned-Dev-${version}-windows-x64.${ext}' },
  nsis: { ...base.nsis, shortcutName: 'PlantLens (Unsigned Development Build)', uninstallDisplayName: 'PlantLens (Unsigned Development Build)' },
};
