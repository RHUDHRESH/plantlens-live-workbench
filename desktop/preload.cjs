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
  evidenceImport: (input) => invoke('plantlens:evidence-import', input),
  evidenceList: () => invoke('plantlens:evidence-list'),
  evidenceSearch: (input) => invoke('plantlens:evidence-search', input),
  evidenceRead: (input) => invoke('plantlens:evidence-read', input),
  webResearch: (input) => invoke('plantlens:web-research', input),
  researchImport: (input) => invoke('plantlens:research-import', input),
  researchStatus: () => invoke('plantlens:research-status'),
  researchConfigure: (input) => invoke('plantlens:research-configure', input),
  engineeringStateLoad: () => invoke('plantlens:engineering-state-load'),
  engineeringStateSave: (state, expectedRevision) => invoke('plantlens:engineering-state-save', state, expectedRevision),
  onModelEvent,
}));
