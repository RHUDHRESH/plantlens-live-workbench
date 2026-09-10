const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DesktopStore, RevisionConflictError } = require('../store.cjs');
const { validateEngineeringState } = require('../engineering-state.cjs');
const binding = { id:'b1',assetId:'a1',deviceUuid:'123e4567-e89b-42d3-a456-426614174000',schemaHash:'a'.repeat(64),channelId:'c1',signal:'speed',dataType:'FLOAT32',sourceUnit:'rpm',canonicalUnit:'rpm',scale:1,offset:0,range:{min:0,max:100},cadenceMs:100,state:'PROPOSED',createdAtMs:1,createdBy:'operator' };
test('engineering state validator rejects unknown fields and unsafe approved register evidence', () => {
  assert.throws(() => validateEngineeringState({ schemaVersion:1,revision:0,bindings:[],proposals:[],extra:true }));
  assert.throws(() => validateEngineeringState({ schemaVersion:1,revision:1,bindings:[{...binding,state:'APPROVED',approvedAtMs:2,approvedBy:'op',modbus:{deviceModel:'Drive X',address:4,functionCode:3,evidence:{id:'e',title:'forum',url:'https://example.com',official:false}}}],proposals:[] }), /official/);
});
test('engineering state persists immutable optimistic revisions', t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'plantlens-eng-')); const store=new DesktopStore(path.join(dir,'db')); t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
  const s={schemaVersion:1,revision:1,bindings:[],proposals:[{id:'p1',baseRevision:0,status:'IN_REVIEW',binding,validation:{errors:[],warnings:[]}}]};
  store.engineeringStateSave(validateEngineeringState(s),0); assert.deepEqual(store.engineeringStateLoad(),s);
  assert.throws(()=>store.engineeringStateSave(s,0),RevisionConflictError);
});
