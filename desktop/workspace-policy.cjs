'use strict';

const ID = /^[A-Za-z0-9_.:/+\-]{1,160}$/;
const views = new Set(['signal', 'electrical', 'presentation']);
const assetKinds = new Set(['sensor', 'conditioner', 'isolation', 'controller', 'drive', 'motor', 'protection', 'ground']);
const signals = new Set(['analog', 'digital', 'power', 'earth', 'telemetry']);

function fail(message) { throw new TypeError(`Invalid CAD workspace: ${message}`); }
function object(value, label) { if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`); return value; }
function exact(value, keys, label) { object(value, label); const allowed = new Set(keys); for (const key of Object.keys(value)) if (!allowed.has(key)) fail(`${label} contains unknown field ${key}`); }
function string(value, label, max, { optional = false } = {}) { if (optional && value === undefined) return; if (typeof value !== 'string' || !value.trim() || value.length > max) fail(`${label} must contain 1-${max} characters`); }
function id(value, label) { if (typeof value !== 'string' || !ID.test(value)) fail(`${label} is invalid`); }
function array(value, label, max) { if (!Array.isArray(value) || value.length > max) fail(`${label} must be an array of at most ${max} items`); return value; }
function unique(items, label) { const seen = new Set(); for (const item of items) { if (seen.has(item.id)) fail(`duplicate ${label} ID ${item.id}`); seen.add(item.id); } return seen; }

function validateProposal(proposal, documentRevision, assetIds) {
  exact(proposal, ['id', 'request', 'source', 'status', 'baseRevision', 'changes', 'message', 'createdAt', 'citations'], 'proposal');
  id(proposal.id, 'proposal.id'); string(proposal.request, 'proposal.request', 12000);
  if (!['LOCAL_MODEL', 'DETERMINISTIC'].includes(proposal.source)) fail('proposal.source is invalid');
  if (!['READY', 'BLOCKED', 'COMPLETED'].includes(proposal.status)) fail('proposal.status is invalid');
  if (proposal.baseRevision !== undefined && (!Number.isSafeInteger(proposal.baseRevision) || proposal.baseRevision < 0 || proposal.baseRevision > documentRevision)) fail('proposal.baseRevision is invalid');
  if (proposal.status === 'READY' && proposal.baseRevision === undefined) fail('a READY proposal requires baseRevision');
  string(proposal.message, 'proposal.message', 600, { optional: true }); string(proposal.createdAt, 'proposal.createdAt', 64);
  const citations = array(proposal.citations ?? [], 'proposal.citations', 8);
  for (const citation of citations) {
    exact(citation, ['excerptId', 'evidenceId', 'source'], 'proposal citation');
    string(citation.excerptId, 'proposal citation.excerptId', 100);
    string(citation.evidenceId, 'proposal citation.evidenceId', 100);
    string(citation.source, 'proposal citation.source', 200);
  }
  if (!Number.isFinite(Date.parse(proposal.createdAt))) fail('proposal.createdAt is invalid');
  const changes = array(proposal.changes, 'proposal.changes', 16); unique(changes, 'proposal change');
  for (const change of changes) {
    exact(change, ['id', 'kind', 'summary', 'assetId', 'value', 'status'], 'proposal change');
    id(change.id, 'proposal change.id'); string(change.summary, 'proposal change.summary', 300); string(change.value, 'proposal change.value', 400);
    if (!['PENDING', 'APPROVED', 'REJECTED'].includes(change.status)) fail('proposal change.status is invalid');
    if (change.kind === 'rename_asset') {
      id(change.assetId, 'rename_asset.assetId');
      if (!assetIds.has(change.assetId)) fail(`rename_asset references unknown asset ${change.assetId}`);
      if (change.value.length > 120) fail('rename_asset value is too long');
    } else if (change.kind === 'add_asset') {
      if (change.assetId !== undefined && change.assetId !== '') fail('add_asset must not target an existing assetId');
      let added; try { added = JSON.parse(change.value); } catch { fail('add_asset value must be JSON'); }
      exact(added, ['id', 'kind', 'name'], 'add_asset value'); id(added.id, 'add_asset value.id');
      if (assetIds.has(added.id) || !['sensor', 'motor', 'drive', 'controller'].includes(added.kind)) fail('add_asset value has a duplicate ID or unsupported kind');
      string(added.name, 'add_asset value.name', 120);
    } else fail('proposal change operation is not allowed');
  }
}

function validateWorkspace(value) {
  const document = object(value, 'document');
  exact(document, ['schemaVersion', 'id', 'name', 'revision', 'assets', 'terminals', 'placements', 'connections', 'proposals'], 'document');
  if (document.schemaVersion !== 1) fail('schemaVersion must be 1');
  id(document.id, 'document.id'); string(document.name, 'document.name', 200);
  if (!Number.isSafeInteger(document.revision) || document.revision < 0) fail('document.revision must be a non-negative integer');

  const assets = array(document.assets, 'assets', 500);
  const terminals = array(document.terminals, 'terminals', 2000);
  const placements = array(document.placements, 'placements', 2000);
  const connections = array(document.connections, 'connections', 4000);
  const proposals = array(document.proposals, 'proposals', 100);
  for (const asset of assets) {
    exact(asset, ['id', 'name', 'kind', 'description', 'terminalIds'], 'asset'); id(asset.id, 'asset.id'); string(asset.name, 'asset.name', 120); string(asset.description, 'asset.description', 1000);
    if (!assetKinds.has(asset.kind)) fail('asset.kind is invalid');
    const ids = array(asset.terminalIds, 'asset.terminalIds', 128); const seen = new Set();
    for (const terminalId of ids) { id(terminalId, 'asset.terminalIds[]'); if (seen.has(terminalId)) fail(`duplicate terminal reference ${terminalId}`); seen.add(terminalId); }
  }
  const assetIds = unique(assets, 'asset');
  for (const terminal of terminals) {
    exact(terminal, ['id', 'assetId', 'name', 'direction', 'signalType', 'unit'], 'terminal'); id(terminal.id, 'terminal.id'); id(terminal.assetId, 'terminal.assetId'); string(terminal.name, 'terminal.name', 120); string(terminal.unit, 'terminal.unit', 40, { optional: true });
    if (!assetIds.has(terminal.assetId) || !['in', 'out', 'bidirectional'].includes(terminal.direction) || !signals.has(terminal.signalType)) fail(`terminal ${terminal.id} has invalid ownership or type`);
  }
  unique(terminals, 'terminal');
  const terminalMap = new Map(terminals.map(item => [item.id, item]));
  for (const asset of assets) for (const terminalId of asset.terminalIds) if (terminalMap.get(terminalId)?.assetId !== asset.id) fail(`asset ${asset.id} has invalid terminal reference ${terminalId}`);
  for (const terminal of terminals) if (!assets.find(asset => asset.id === terminal.assetId).terminalIds.includes(terminal.id)) fail(`terminal ${terminal.id} is missing from its asset`);

  const placementKeys = new Set();
  for (const placement of placements) {
    exact(placement, ['assetId', 'view', 'x', 'y'], 'placement'); id(placement.assetId, 'placement.assetId');
    if (!assetIds.has(placement.assetId) || !views.has(placement.view) || !Number.isFinite(placement.x) || !Number.isFinite(placement.y)) fail('placement contains invalid asset, view, or coordinates');
    const key = `${placement.view}\0${placement.assetId}`; if (placementKeys.has(key)) fail('duplicate asset placement in a view'); placementKeys.add(key);
  }
  for (const connection of connections) {
    exact(connection, ['id', 'view', 'sourceTerminalId', 'targetTerminalId', 'signalType', 'unit', 'evidence', 'verification'], 'connection');
    id(connection.id, 'connection.id'); id(connection.sourceTerminalId, 'connection.sourceTerminalId'); id(connection.targetTerminalId, 'connection.targetTerminalId');
    string(connection.unit, 'connection.unit', 40, { optional: true }); string(connection.evidence, 'connection.evidence', 2000, { optional: true });
    if (!['signal', 'electrical'].includes(connection.view) || !signals.has(connection.signalType) || !['VERIFIED', 'TEMPLATE', 'UNVERIFIED'].includes(connection.verification)) fail('connection metadata is invalid');
    const source = terminalMap.get(connection.sourceTerminalId), target = terminalMap.get(connection.targetTerminalId);
    if (!source || !target || source.id === target.id || source.assetId === target.assetId) fail(`connection ${connection.id} has invalid endpoint references`);
    if (source.direction === 'in' || target.direction === 'out' || source.signalType !== target.signalType || connection.signalType !== source.signalType) fail(`connection ${connection.id} has incompatible terminal types or directions`);
    if (source.unit && target.unit && source.unit !== target.unit) fail(`connection ${connection.id} has incompatible terminal units`);
    if (connection.unit && ((source.unit && connection.unit !== source.unit) || (target.unit && connection.unit !== target.unit))) fail(`connection ${connection.id} has an incompatible unit`);
    if (connection.view === 'electrical' && !['power', 'earth'].includes(connection.signalType)) fail(`connection ${connection.id} is not electrical`);
  }
  unique(connections, 'connection'); unique(proposals, 'proposal');
  for (const proposal of proposals) validateProposal(proposal, document.revision, assetIds);
  return document;
}

module.exports = { validateWorkspace };
