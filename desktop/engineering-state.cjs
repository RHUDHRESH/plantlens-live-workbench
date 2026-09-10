const exact = (value, keys, label) => { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))) throw new TypeError(`${label} has unknown or invalid fields`); };
const text = (v, label, max = 120) => { if (typeof v !== 'string' || !v.trim() || v.length > max) throw new TypeError(`${label} must contain 1-${max} characters`); };
const finite = (v, label) => { if (!Number.isFinite(v)) throw new TypeError(`${label} must be finite`); };
function validateEvidence(v, approved) { exact(v, ['id','title','url','official'], 'evidence'); text(v.id,'evidence.id',100); text(v.title,'evidence.title',200); text(v.url,'evidence.url',2048); if (!v.url.startsWith('https://') || typeof v.official !== 'boolean' || approved && v.official !== true) throw new TypeError('Approved Modbus bindings require an official HTTPS source'); }
function validateModbus(v, approved) { exact(v, ['deviceModel','address','functionCode','evidence'], 'modbus'); text(v.deviceModel,'modbus.deviceModel',120); if (/^(unknown|generic|vfd)$/i.test(v.deviceModel.trim()) || !Number.isSafeInteger(v.address) || v.address < 0 || v.address > 65535 || ![3,4].includes(v.functionCode)) throw new TypeError('Invalid Modbus model, address, or function code'); validateEvidence(v.evidence, approved); }
function validateBinding(v) {
  const common = ['id','assetId','deviceUuid','schemaHash','channelId','signal','dataType','sourceUnit','canonicalUnit','scale','offset','range','cadenceMs','state','createdAtMs','createdBy','approvedAtMs','approvedBy','modbus'];
  exact(v, common, 'binding');
  for (const key of ['id','assetId','deviceUuid','schemaHash','channelId','signal','dataType','sourceUnit','canonicalUnit']) text(v[key],`binding.${key}`,100);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v.deviceUuid) || !/^[0-9a-f]{64}$/i.test(v.schemaHash)) throw new TypeError('Invalid device UUID or schema hash');
  const dataTypes = ['FLOAT32','FLOAT64','INT8','UINT8','INT16','UINT16','INT32','UINT32','INT64','UINT64','BOOLEAN','STRING'];
  finite(v.scale,'binding.scale'); finite(v.offset,'binding.offset'); exact(v.range,['min','max'],'binding.range'); finite(v.range.min,'range.min'); finite(v.range.max,'range.max');
  if (!dataTypes.includes(v.dataType) || v.scale === 0 || v.range.min >= v.range.max || !Number.isSafeInteger(v.cadenceMs) || v.cadenceMs < 50 || v.cadenceMs > 86_400_000 || !['PROPOSED','APPROVED'].includes(v.state)) throw new TypeError('Invalid binding data type, range, cadence, scale, or state');
  if (v.state === 'APPROVED') {
    const encoded = v.sourceUnit.match(/^([0-9]+(?:\.[0-9]+)?)\s*(.+)$/);
    const validConversion = v.sourceUnit === v.canonicalUnit ? v.scale === 1 && v.offset === 0 : encoded && encoded[2] === v.canonicalUnit && Number(encoded[1]) === v.scale && v.offset === 0;
    if (!validConversion) throw new TypeError('Unsupported approved unit conversion');
  }
  finite(v.createdAtMs,'createdAtMs'); if (v.createdAtMs < 0) throw new TypeError('createdAtMs must be nonnegative'); text(v.createdBy,'createdBy',120);
  const approvedPair = v.approvedAtMs !== undefined || v.approvedBy !== undefined;
  if ((v.state === 'APPROVED') !== approvedPair || approvedPair && (v.approvedAtMs === undefined || v.approvedBy === undefined)) throw new TypeError('Approval fields must be paired and present only for approved bindings');
  if (approvedPair) { finite(v.approvedAtMs,'approvedAtMs'); if (v.approvedAtMs < 0) throw new TypeError('approvedAtMs must be nonnegative'); text(v.approvedBy,'approvedBy',120); }
  if (v.modbus !== undefined) validateModbus(v.modbus, v.state === 'APPROVED'); return v;
}
function validateEngineeringState(state) {
  exact(state,['schemaVersion','revision','bindings','proposals'],'engineering state');
  if (state.schemaVersion !== 1 || !Number.isSafeInteger(state.revision) || state.revision < 0 || !Array.isArray(state.bindings) || state.bindings.length > 1000 || !Array.isArray(state.proposals) || state.proposals.length > 500) throw new TypeError('Invalid engineering state bounds');
  const ids = new Set(); state.bindings.forEach(v => { validateBinding(v,false); if (ids.has(v.id)) throw new TypeError('Duplicate binding ID'); ids.add(v.id); });
  const proposalIds = new Set(); state.proposals.forEach(v => { exact(v,['id','baseRevision','status','binding','validation'],'proposal'); text(v.id,'proposal.id',100); if (!Number.isSafeInteger(v.baseRevision) || v.baseRevision < 0 || v.baseRevision > state.revision || !['IN_REVIEW','APPROVED','REJECTED','BLOCKED'].includes(v.status) || proposalIds.has(v.id)) throw new TypeError('Invalid proposal'); proposalIds.add(v.id); validateBinding(v.binding,true); exact(v.validation,['errors','warnings'],'validation'); for (const key of ['errors','warnings']) { if (!Array.isArray(v.validation[key]) || v.validation[key].length > 50) throw new TypeError('Invalid validation messages'); v.validation[key].forEach(x => text(x,`validation.${key}`,300)); } });
  return state;
}
module.exports = { validateEngineeringState };
