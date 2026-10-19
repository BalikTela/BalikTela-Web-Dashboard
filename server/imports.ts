import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import type { Express } from 'express';
import ExcelJS from 'exceljs';
import { IMPORT_COLUMNS, IMPORT_MAX_BYTES, IMPORT_MAX_ROWS, IMPORT_COMMIT_ROWS, IMPORT_RECORD_NAMES, type ImportPreview, type ImportResult, type ImportExistingRecord } from '../shared/imports.js';
import { MATERIAL_CATEGORIES } from '../shared/workflows.js';
import { authorize, hasPermission } from './access-control.js';
import { requireAuth, type AuthenticatedRequest } from './auth.js';
import { canonicalMutations, type RecordMutation } from './database/mutations.js';
import { ManagementError, number, text } from './management.js';
import type { Store } from './store.js';
import type { MaterialBatchRecord, ListingRecord, TransferRecord, RecoveryRecord, UserRecord } from './types.js';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const round = (value: number) => Number(value.toFixed(6));
interface ImportPlan { preview: ImportPreview; groups: RecordMutation[][] }

export function importCsv(body: Record<string, unknown>) {
  if (!Array.isArray(body.csvChunks) || !body.csvChunks.length || body.csvChunks.length > 64 || body.csvChunks.some(value => typeof value !== 'string' || value.length > 8000)) throw new ManagementError('Select a bounded CSV file.');
  const csv = body.csvChunks.join('');
  if (Buffer.byteLength(csv,'utf8') > IMPORT_MAX_BYTES || csv.split('\n').length > 2000) throw new ManagementError(`CSV files must be at most ${IMPORT_MAX_BYTES} bytes and ${IMPORT_MAX_ROWS} data rows.`);
  return csv;
}

export async function planImport(store: Store, actor: UserRecord, csv: string, now = new Date(), startRow = 0, rowLimit = IMPORT_MAX_ROWS): Promise<ImportPlan> {
  if (!hasPermission(actor, 'batches.manage')) throw new ManagementError('Only authorized administrators may import datasets.',403);
  if (!csv.trim() || Buffer.byteLength(csv,'utf8') > IMPORT_MAX_BYTES) throw new ManagementError('Select a non-empty CSV within the file size limit.');
  const workbook = new ExcelJS.Workbook();
  let sheet: ExcelJS.Worksheet;
  try { sheet = await workbook.csv.read(Readable.from([csv]), { map: value => value }); }
  catch { throw new ManagementError('The file could not be parsed as CSV. Check quoting and delimiters.'); }
  const headers = IMPORT_COLUMNS.map((_, index) => String(sheet.getRow(1).getCell(index + 1).value ?? '').replace(/^\uFEFF/,'').trim());
  if (sheet.getRow(1).cellCount !== IMPORT_COLUMNS.length || headers.some((value,index) => value !== IMPORT_COLUMNS[index])) throw new ManagementError('CSV columns must match the downloaded template, in order.');
  if (sheet.rowCount < 2 || sheet.rowCount - 1 > IMPORT_MAX_ROWS) throw new ManagementError(`Import between 1 and ${IMPORT_MAX_ROWS} data rows per file.`);
  const [users, facilities] = await Promise.all([store.all('users'), store.all('facilities')]);
  const existing = new Map<string, ImportExistingRecord>();
  if (store.lookupImportRecords) {
    const prefixes = Array.from({ length: Math.min(rowLimit, sheet.rowCount - 1 - startRow) }, (_, index) =>
      `IMP-DEMO-${hash(String(sheet.getRow(startRow + index + 2).getCell(1).value ?? '').trim()).slice(0,24)}`);
    const suffixes = { materialBatches:['BAT'], listings:['LST'], offers:['REQ'], transfers:['TRF'],
      measurements:['DECL','RCPT','VALID','OUT'], recoveryRecords:['COL','SORT','FINAL'] };
    const records = await store.lookupImportRecords(IMPORT_RECORD_NAMES.map(name => ({ name,
      ids: prefixes.flatMap(prefix => suffixes[name].map(suffix => `${prefix}-${suffix}`)) })));
    for (const record of records) existing.set(`${record.name}:${record.id}`, record);
  } else {
    for (const name of IMPORT_RECORD_NAMES) {
      for (const record of await store.all(name)) existing.set(`${name}:${record.id}`, { name, ...record });
    }
  }
  const preview: ImportPreview = { previewHash: hash(`${actor.id}\0${csv}`), valid: true, totalRows: sheet.rowCount - 1, newRows: 0, skippedRows: 0,
    totals: { declaredKg: 0, collectedKg: 0, reusedKg: 0, recycledKg: 0 }, rows: [] };
  const groups: RecordMutation[][] = [], seen = new Set<string>();
  for (let index = 2; index <= sheet.rowCount; index++) {
    const values = IMPORT_COLUMNS.map((_, column) => String(sheet.getRow(index).getCell(column + 1).value ?? '').trim());
    const row = Object.fromEntries(IMPORT_COLUMNS.map((key,column) => [key,values[column]]));
    let externalId = row.external_id, batchId = '';
    try {
      externalId = text(externalId,'External ID');
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(externalId)) throw new ManagementError('External ID must be 1-80 letters, numbers, dots, underscores or hyphens.');
      if (seen.has(externalId)) throw new ManagementError('Duplicate external ID inside this file.');
      seen.add(externalId);
      if (sheet.getRow(index).cellCount > IMPORT_COLUMNS.length) throw new ManagementError('Unexpected extra columns.');
      const key = `IMP-DEMO-${hash(externalId).slice(0,24)}`;
      const makeId = (suffix: string) => `${key}-${suffix}`;
      batchId = makeId('BAT');
      const note = `Synthetic bulk import v1 (demo only). External ID: ${externalId}. Fingerprint: ${hash(JSON.stringify(values))}`;
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(row.registered_at) || !Number.isFinite(Date.parse(row.registered_at))
        || new Date(`${row.registered_at.slice(0,10)}T00:00:00Z`).toISOString().slice(0,10) !== row.registered_at.slice(0,10)
        || Number(row.registered_at.slice(11,13)) > 23) throw new ManagementError('Registration requires a valid ISO timestamp with timezone.');
      const createdAt = new Date(row.registered_at).toISOString();
      if (Date.parse(createdAt) + 6000 > now.getTime()) throw new ManagementError('Registration and lifecycle events cannot be future dated.');
      const source = users.find(user => user.id === row.source_user_id && user.role === 'Producer' && user.accountStatus === 'Active');
      if (!source) throw new ManagementError('Source must reference an existing active Producer ID.');
      if (!source.city || !source.region) throw new ManagementError('Source needs structured city and region before importing.');
      if (!(MATERIAL_CATEGORIES as readonly string[]).includes(row.material_category)) throw new ManagementError('Material category does not match the shared mobile categories.');
      const declared = number(row.declared_kg,'Declared kilograms',0.001);
      const collected = row.collected_kg === '' ? null : number(row.collected_kg,'Collected kilograms');
      const sorted = row.sorted_kg === '' ? null : number(row.sorted_kg,'Sorted kilograms');
      const final = row.outcome_kg === '' ? null : number(row.outcome_kg,'Outcome kilograms');
      const outcome = row.outcome || null;
      if (collected !== null && collected > declared || sorted !== null && (collected === null || sorted > collected) || final !== null && (collected === null || final > (sorted ?? collected))) throw new ManagementError('Mass must reconcile: declared >= collected >= sorted >= final output.');
      if (outcome !== null && !['Reuse','Recycling'].includes(outcome) || (outcome === null) !== (final === null)) throw new ManagementError('Outcome and outcome_kg must both be blank, or specify Reuse/Recycling with its output.');
      if (declared > 1e9 || [declared,collected,sorted,final].some(value => value !== null && value !== round(value))) throw new ManagementError('Use realistic finite masses with at most six decimal places.');
      const recipient = users.find(user => user.id === row.recipient_user_id && user.accountStatus === 'Active' && ['Recycler','BalikTela Hub','Upcycler'].includes(user.role));
      const facility = facilities.find(item => item.id === row.facility_id && item.status !== 'Inactive');
      if (collected !== null && (!recipient || !facility || recipient.organizationId !== facility.organizationId)) throw new ManagementError('Collection requires an active receiving partner and an active facility in the same organization.');
      if (collected !== null && collected <= 0) throw new ManagementError('Leave collection blank when there is no physical intake.');
      const complete = final !== null;
      const at = (seconds: number) => new Date(Date.parse(createdAt) + seconds * 1000).toISOString();
      const batch: MaterialBatchRecord = { id: batchId, sourceUserId: source.id, sourceOrganizationId: source.organizationId,
        materialCategory: row.material_category, wasteSource: 'Pre-consumer', wasteForm: 'Offcuts', condition: outcome === 'Reuse' ? 'Reusable' : 'Recyclable', circularPathway: outcome === 'Reuse' ? 'Reuse' : 'Recycling',
        declaredWeightKg: declared, currentWeightKg: collected === null ? declared : round(collected - (final ?? 0)), weightStatus: collected === null ? 'Estimated' : 'Verified', secondaryQuantity: null, secondaryUnit: null,
        city: source.city, region: source.region, currentStatus: complete ? 'Recovered' : collected === null ? 'Listed' : 'Received', currentCustodianId: recipient && collected !== null ? recipient.id : source.id, createdAt, updatedAt: at(6), isDemo: true };
      const listing: ListingRecord = { id: makeId('LST'), batchId, ownerId: source.id, ownerOrganizationId: source.organizationId, ownerName: source.organization || source.fullName,
        title: `Demo import ${externalId}`, description: note, textileType: batch.materialCategory, wasteSource: batch.wasteSource, wasteForm: batch.wasteForm, circularPathway: batch.circularPathway,
        quantityKg: declared, availableWeightKg: collected === null ? declared : 0, reservedKg: 0, weightStatus: batch.weightStatus, quality: batch.condition, exchangeFor: 'Synthetic demonstration only', rewardCredits: 0,
        city: batch.city, region: batch.region, status: complete ? 'Completed' : collected === null ? 'Open' : 'Reserved', createdAt, isDemo: true };
      const writes: RecordMutation[] = [{ name:'materialBatches',record:batch }, { name:'listings',record:listing },
        { name:'measurements',record:{ id:makeId('DECL'),batchId,transferId:null,stage:'Declaration',weightKg:declared,status:'Estimated',method:'Synthetic imported declaration',recordedBy:source.id,verifiedBy:null,timestamp:createdAt,note } }];
      if (collected !== null && recipient && facility) {
        const transferId = makeId('TRF'), offerId = makeId('REQ');
        writes.push({ name:'offers',record:{ id:offerId,listingId:listing.id,listingTitle:listing.title,recipientId:recipient.id,recipientName:recipient.fullName,providerId:source.id,quantityKg:collected,terms:note,offeredCredits:0,status:'Accepted',createdAt,updatedAt:at(1) } });
        const transfer: TransferRecord = { id:transferId,listingId:listing.id,batchId,offerId,providerId:source.id,recipientId:recipient.id,materialCategory:batch.materialCategory,agreedWeightKg:collected,handoverWeightKg:collected,receiptWeightKg:collected,verifiedWeightKg:collected,
          status:complete?'Completed':'Received',discrepancyKg:0,discrepancyReason:'',circularOutcome:outcome as TransferRecord['circularOutcome'],agreedTerms:note,pendingRewardCredits:0,rewardIssuedAt:null,createdAt,updatedAt:at(6),isDemo:true,
          events: (['Offer accepted','Handover','Receipt','Validation',...(complete?['Processing','Completion']:[])] as TransferRecord['events'][number]['type'][]).map((type,eventIndex) => ({ id:makeId(`EVT-${eventIndex}`),type,actorId:eventIndex<2?source.id:recipient.id,actorName:eventIndex<2?source.fullName:recipient.fullName,timestamp:at(eventIndex+1),status:'Completed',location:`${batch.city}, ${batch.region}`,note,measurementId:type==='Receipt'?makeId('RCPT'):type==='Validation'?makeId('VALID'):type==='Processing'?makeId('OUT'):null,
            weightKg:type==='Processing'?final:type==='Offer accepted'||type==='Completion'?null:collected,weightStatus:type==='Handover'?'Estimated':type==='Offer accepted'||type==='Completion'?null:'Verified' })) };
        writes.push({name:'transfers',record:transfer},
          {name:'measurements',record:{id:makeId('RCPT'),batchId,transferId,stage:'Receipt',weightKg:collected,status:'Verified',method:'Synthetic imported receipt',recordedBy:recipient.id,verifiedBy:recipient.id,timestamp:at(3),note,facilityId:facility.id}},
          {name:'measurements',record:{id:makeId('VALID'),batchId,transferId,stage:'Validation',weightKg:collected,status:'Verified',method:'Synthetic imported validation',recordedBy:recipient.id,verifiedBy:recipient.id,timestamp:at(4),note,facilityId:facility.id}});
        const recovery = (suffix: string, stage: RecoveryRecord['stage'], input: number, output: number, timestamp: string): RecordMutation => ({ name:'recoveryRecords',record:{ id:makeId(suffix),batchId,transferId,facilityId:facility.id,organizationId:facility.organizationId,stage,inputWeightKg:input,outputWeightKg:output,residualWeightKg:round(input-output),lossWeightKg:0,outcome:outcome as RecoveryRecord['outcome'],status:'Validated',recordedBy:recipient.id,validatedBy:recipient.id,timestamp,note,isDemo:true } });
        writes.push(recovery('COL','Collection',declared,collected,at(3)));
        if (sorted !== null) writes.push(recovery('SORT','Sorting',collected,sorted,at(4)));
        if (final !== null) writes.push(recovery('FINAL','Recovery',sorted ?? collected,final,at(5)),{name:'measurements',record:{id:makeId('OUT'),batchId,transferId,stage:'Recovery',canonicalStage:'recovery_output',weightKg:final,status:'Verified',method:'Synthetic imported final output',recordedBy:recipient.id,verifiedBy:recipient.id,timestamp:at(5),note,facilityId:facility.id}});
      }
      // Validate the whole file, but only resolve/write the current bounded request window.
      if (index - 2 < startRow || index - 2 >= startRow + rowLimit) continue;
      const present = writes.filter(write => existing.has(`${write.name}:${write.record.id}`));
      if (present.length) {
        const priorBatch = existing.get(`materialBatches:${batchId}`);
        const priorListing = existing.get(`listings:${listing.id}`);
        if (present.length !== writes.length || priorBatch?.isDemo !== true || priorListing?.description !== note) throw new ManagementError('External ID conflicts with an existing or changed dataset. No records will be overwritten.');
        preview.skippedRows++;
      } else {
        groups.push(writes); preview.newRows++;
        preview.totals.declaredKg += declared; preview.totals.collectedKg += collected ?? 0;
        if (outcome === 'Reuse') preview.totals.reusedKg += final ?? 0;
        if (outcome === 'Recycling') preview.totals.recycledKg += final ?? 0;
      }
      preview.rows.push({ row:index,externalId,batchId,status:present.length?'Already imported':'New',message:'Demo lifecycle; no rewards or accounts created.' });
    } catch (reason) {
      preview.valid=false; preview.rows.push({row:index,externalId,batchId,status:'Invalid',message:reason instanceof ManagementError?reason.message:'Invalid CSV row.'});
    }
  }
  for (const key of Object.keys(preview.totals) as Array<keyof ImportPreview['totals']>) preview.totals[key]=round(preview.totals[key]);
  return {preview,groups};
}

export async function commitImport(store: Store, actor: UserRecord, csv: string, previewHash: string, reason: string, now = new Date(), startRow?: number): Promise<ImportResult> {
  if (startRow !== undefined && (!Number.isInteger(startRow) || startRow < 0 || startRow >= IMPORT_MAX_ROWS)) throw new ManagementError('Import position is invalid. Preview the file again.');
  const plan=await planImport(store,actor,csv,now,startRow ?? 0,startRow === undefined ? IMPORT_MAX_ROWS : IMPORT_COMMIT_ROWS);
  if (startRow !== undefined && startRow >= plan.preview.totalRows) throw new ManagementError('Import position exceeds the file.');
  if (!plan.preview.valid || plan.preview.previewHash !== previewHash) throw new ManagementError('Preview this exact file and resolve every error before importing.');
  text(reason,'Import reason');
  let importedRows=0;
  // Each chunk is one atomic transaction below the existing 200 canonical-mutation limit.
  for (let offset=0;offset<plan.groups.length;offset+=5) {
    const chunk=plan.groups.slice(offset,offset+5), writes=chunk.flat();
    let current: UserRecord | null;
    try { current=await store.findById('users',actor.id); }
    catch { return {complete:false,importedRows,skippedRows:plan.preview.skippedRows,message:'Import paused while checking administrator access. Some rows may already be saved. Preview the same file to check progress and resume safely.'}; }
    if (!current || !hasPermission(current,'batches.manage')) return {complete:false,importedRows,skippedRows:plan.preview.skippedRows,message:'Import stopped because administrator access changed. Completed chunks are retained; an authorized administrator can resume the same file.'};
    writes.push({name:'auditRecords',record:{id:`AUD-${randomUUID()}`,actorId:actor.id,action:'dataset.demo.imported',entityType:'materialBatches',entityId:plan.preview.previewHash,timestamp:now.toISOString(),details:JSON.stringify({reason,demo:true,rows:chunk.length,batchIds:chunk.map(items=>items[0].record.id)})}});
    if (canonicalMutations(writes).length>200) throw new ManagementError('Import chunk exceeds the transaction limit.');
    try { await store.commit(writes); importedRows+=chunk.length; }
    catch { return {complete:false,importedRows,skippedRows:plan.preview.skippedRows,message:'The latest save response could not be confirmed. Some rows may already be saved. Preview and retry the same file to skip saved rows; no existing records were overwritten.'}; }
  }
  const nextRow = startRow === undefined ? plan.preview.totalRows : Math.min(startRow + IMPORT_COMMIT_ROWS, plan.preview.totalRows);
  const complete = nextRow === plan.preview.totalRows;
  return {complete,importedRows,skippedRows:plan.preview.skippedRows,nextRow,totalRows:plan.preview.totalRows,
    message:complete?'Demo dataset imported. Analytics refresh automatically; the selected dates and scope still apply.':'Import progress saved. Continue with the next group.'};
}

export function registerImportRoutes(app: Express, store: Store) {
  app.use('/api/imports',(_req,res,next)=>{res.setHeader('Cache-Control','private, no-store');next();});
  app.get('/api/imports/options',requireAuth,authorize(store,'batches.manage'),async (_req,res)=>{
    const [users,facilities]=await Promise.all([store.all('users'),store.all('facilities')]);
    res.json({producers:users.filter(user=>user.role==='Producer'&&user.accountStatus==='Active').map(user=>({id:user.id,name:user.fullName,region:user.region})),recipients:users.filter(user=>['Recycler','BalikTela Hub','Upcycler'].includes(user.role)&&user.accountStatus==='Active').map(user=>({id:user.id,name:user.fullName,organizationId:user.organizationId})),facilities:facilities.filter(item=>item.status!=='Inactive').map(item=>({id:item.id,name:item.name,organizationId:item.organizationId}))});
  });
  app.post('/api/imports/preview',requireAuth,authorize(store,'batches.manage'),async (req:AuthenticatedRequest,res)=>res.json((await planImport(store,req.actor!,importCsv(req.body))).preview));
  app.post('/api/imports/commit',requireAuth,authorize(store,'batches.manage'),async (req:AuthenticatedRequest,res)=>res.json(await commitImport(store,req.actor!,importCsv(req.body),text(req.body.previewHash,'Preview hash'),text(req.body.reason,'Import reason'),new Date(),req.body.startRow ?? 0)));
}
