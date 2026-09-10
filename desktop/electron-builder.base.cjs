module.exports = {
  appId: 'com.plantlens.desktop', productName: 'PlantLens', asar: true, asarUnpack: ['**/*.node'],
  files: ['main.cjs', 'preload.cjs', 'store.cjs', 'workspace-policy.cjs', 'model-manager.cjs', 'inference.cjs', 'evidence-tools.cjs', 'research-tools.cjs', 'engineering-state.cjs', 'model-manifest.json', 'assets/**/*'],
  extraResources: [
    { from: 'dist-resources/app-server', to: 'app-server' },
    { from: 'dist-resources/app-server/node_modules', to: 'app-server/node_modules' },
    { from: 'dist-resources/companion', to: 'companion' },
    { from: 'dist-resources/companion/node_modules', to: 'companion/node_modules' },
    { from: 'dist-resources/runtime', to: 'runtime' },
  ],
  win: { target: [{ target: 'nsis', arch: ['x64'] }], artifactName: 'PlantLens-${version}-windows-x64.${ext}' },
  nsis: { oneClick: false, perMachine: false, allowElevation: false, createDesktopShortcut: false, createStartMenuShortcut: true, shortcutName: 'PlantLens', deleteAppDataOnUninstall: false },
};
