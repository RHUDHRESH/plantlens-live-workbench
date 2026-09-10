const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
const onModelEvent = (listener) => {
  if (typeof listener !== 'function') throw new TypeError('listener must be a function');
  const wrapped = (_event, value) => listener(value);
  ipcRenderer.on('plantlens:model-event', wrapped);
  return () => ipcRenderer.removeListener('plantlens:model-event', wrapped);
};

contextBridge.exposeInMainWorld('plantlensDesktop', Object.freeze({
  workspaceLoad: () => invoke('plantlens:workspace-load'),
  workspaceSave: (document, expectedRevision) => invoke('plantlens:workspace-save', document, expectedRevision),
  agentDraft: (request, document) => invoke('plantlens:agent-draft', request, document),
  modelStatus: () => invoke('plantlens:model-status'),
  modelInstall: () => invoke('plantlens:model-install'),
  modelPause: () => invoke('plantlens:model-pause'),
  modelCancel: () => invoke('plantlens:model-cancel'),
  modelUnload: () => invoke('plantlens:model-unload'),
  companionSession: () => invoke('plantlens:companion-session'),
  onModelEvent,
}));
