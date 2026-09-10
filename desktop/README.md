# PlantLens desktop runtime

The desktop shell requires the root Next build to use `output: "standalone"`. Run `npm run fetch:runtime` once to download and SHA-256 verify the pinned llama.cpp archive, build the web app, then run `npm run dist:win` in this directory. `prepare:resources` copies the traced server, public/static files, companion runtime, and verified llama.cpp files. The packaged Electron executable runs both Node services with `ELECTRON_RUN_AS_NODE=1`, so end users do not install Node.js.

Development installers are deliberately labelled unsigned and do not delete `%APPDATA%/PlantLens` on uninstall. `dist:win:signed` refuses to run without CI-provided `CSC_LINK` and `CSC_KEY_PASSWORD`; no credential or private key belongs in this package. Signed update manifest publication remains a release-pipeline responsibility.

Renderer access is limited to the methods exported from `preload.cjs`. Do not add generic file, process, serial, or shell IPC.
