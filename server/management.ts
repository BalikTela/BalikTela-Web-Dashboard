import { randomUUID } from 'node:crypto';
import type { Express, Response } from 'express';
import { authorize, isWithinOperationalScope, scopeBatches, scopeRecoveryRecords } from './access-control.js';
import { requireAuth, type AuthenticatedRequest } from './auth.js';
import type { Store } from './store.js';
import type { RecordMutation } from './database/mutations.js';
import type { FacilityRecord, MaterialBatchRecord, OrganizationRecord, RecoveryRecord, UserRecord } from './types.js';
import { canModerateListing, CIRCULAR_PATHWAYS, MATERIAL_CONDITIONS } from '../shared/workflows.js';

export class ManagementError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export function text(value: unknown, label: string, required = true) {
  const result = String(value ?? '').trim();
  if (required && !result) throw new ManagementError(`${label} is required.`);
  if (result.length > 4000) throw new ManagementError(`${label} is too long.`);
  return result;
}
export function number(value: unknown, label: string, minimum = 0) {
  if (value === '' || value === null || value === undefined) throw new ManagementError(`${label} is required.`);
  const result = Number(value);
  if (!Number.isFinite(result) || result < minimum) throw new ManagementError(`${label} must be a finite number of at least ${minimum}.`);
  return result;
}
export function choice<T extends string>(value: unknown, values: readonly T[], label: string): T {
  if (!values.includes(value as T)) throw new ManagementError(`Select a valid ${label.toLowerCase()}.`);
  return value as T;
}
export function list(value: unknown, label: string) {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new ManagementError(`${label} must be a list of text values.`);
  return [...new Set(value.map(item => text(item, label)).filter(Boolean))];
}
const orgTypes = ['Research','Government','Producer','Recycler','NGO','LGU/Collection Point','Upcycler','Research institution','Government agency','Producer/Retailer','NGO/Community','LGU/MRF','Collection point','Other'] as const;
const facilityTypes = ['Collection point','Sorting facility','Recycler','Upcycling hub','Repair hub'] as const;
const pathways = CIRCULAR_PATHWAYS;
const wasteSources = ['Pre-consumer','Post-consumer','Obsolete inventory','Household','Institutional','Unknown'] as const;
const wasteForms = ['Garments','Offcuts','Fabric rolls','Fiber','Mixed textiles','Other'] as const;
const conditions = MATERIAL_CONDITIONS;
const weights = ['Estimated','Measured','Verified'] as const;
const newId = (prefix: string) => `${prefix}-${randomUUID()}`;

export function organizationValues(body: Record<string, unknown>, current?: OrganizationRecord): OrganizationRecord {
  const input = { ...current, ...body };
  const email = text(input.contactEmail, 'Contact email', false);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ManagementError('Enter a valid contact email.');
  return {
    id: current?.id ?? newId('ORG'), name: text(input.name, 'Organization name'), type: choice(input.type, orgTypes, 'Organization type'),
    city: text(input.city, 'City'), region: text(input.region, 'Region'), contactEmail: email,
    serviceAreas: list(input.serviceAreas ?? [], 'Service areas'), acceptedMaterials: list(input.acceptedMaterials ?? [], 'Accepted materials'),
    recordLabel: choice(input.recordLabel ?? 'Sample', ['Demo','Sample'], 'Record label'),
    status: choice(input.status ?? 'Prospective sample', ['Confirmed demo','Prospective sample','Inactive'], 'Organization status'),
    verification: choice(input.verification ?? 'Pending demo review', ['Demo verified','Pending demo review'], 'Verification'),
  };
}
export function facilityValues(body: Record<string, unknown>, current?: FacilityRecord): FacilityRecord {
  const input = { ...current, ...body };
  return {
    id: current?.id ?? newId('FAC'), organizationId: text(input.organizationId, 'Organization'), name: text(input.name, 'Facility name'),
    type: choice(input.type ?? 'Collection point', facilityTypes, 'Facility type'), city: text(input.city, 'City'), region: text(input.region, 'Region'),
    serviceAreas: list(input.serviceAreas ?? [], 'Service areas'), acceptedMaterials: list(input.acceptedMaterials ?? [], 'Accepted materials'),
    monthlyCapacityKg: number(input.monthlyCapacityKg ?? 0, 'Monthly capacity'), currentIntakeKg: number(input.currentIntakeKg ?? 0, 'Current intake'),
    status: choice(input.status ?? 'Pilot onboarding', ['Available','Near capacity','Maintenance','Pilot onboarding','Inactive'], 'Facility status'),
    verification: choice(input.verification ?? 'Pending demo review', ['Demo verified','Pending demo review'], 'Verification'), isDemo: current?.isDemo ?? body.isDemo === true,
  };
}
export async function saveManagement(store: Store, actor: UserRecord, mutations: RecordMutation[], action: string, entityId: string, reason: string) {
  const safeRecord=(record:RecordMutation['record']|undefined)=>{
    if (!record) return null;
    if ('passwordHash' in record) { const {passwordHash: _hash,authUserId: _auth,...safe}=record; return safe; }
    return record;
  };
  const beforeAfter = mutations.map(item => ({ collection: item.name, before: safeRecord(item.previous), after: safeRecord(item.record) }));
  await store.commit([...mutations, { name: 'auditRecords', record: { id: newId('AUD'), actorId: actor.id, action, entityType: mutations[0].name, entityId,
    timestamp: new Date().toISOString(), details: JSON.stringify({ reason, changes: beforeAfter }) } }]);
}

export function registerManagementRoutes(app: Express, store: Store) {
  app.post('/api/material-batches', requireAuth, authorize(store, 'batches.manage'), async (req: AuthenticatedRequest, res) => {
    const source = await store.findById('users', text(req.body.sourceUserId, 'Source user'));
    if (!source || source.accountStatus !== 'Active') throw new ManagementError('Select an active source user.');
    const at = new Date().toISOString();
    const batch: MaterialBatchRecord = { id: newId('MB'), sourceUserId: source.id, sourceOrganizationId: source.organizationId,
      materialCategory: text(req.body.materialCategory, 'Material category'), wasteSource: choice(req.body.wasteSource, wasteSources, 'Waste source'),
      wasteForm: choice(req.body.wasteForm, wasteForms, 'Waste form'), condition: choice(req.body.condition, conditions, 'Condition'),
      circularPathway: choice(req.body.circularPathway, pathways, 'Circular pathway'), declaredWeightKg: number(req.body.declaredWeightKg, 'Declared weight', 0.001),
      currentWeightKg: number(req.body.declaredWeightKg, 'Declared weight', 0.001), weightStatus: choice(req.body.weightStatus, weights, 'Weight status'),
      secondaryQuantity: null, secondaryUnit: null, city: text(req.body.city ?? source.city, 'City'), region: text(req.body.region ?? source.region, 'Region'),
      currentStatus: 'Recorded', currentCustodianId: source.id, archivedAt: null, createdAt: at, updatedAt: at, isDemo: req.body.isDemo === true };
    await saveManagement(store, req.actor!, [{ name:'materialBatches', record:batch }, { name:'measurements', record:{ id:newId('MSR'), batchId:batch.id, transferId:null, stage:'Declaration',
      weightKg:number(batch.declaredWeightKg,'Declared weight',0.001), status:choice(batch.weightStatus,weights,'Weight status'), method:text(req.body.method, 'Measurement method'), recordedBy:req.actor!.id,
      verifiedBy:batch.weightStatus === 'Verified' ? req.actor!.id : null, timestamp:at, note:text(req.body.reason,'Reason') } }], 'batch.registered', batch.id, req.body.reason);
    res.status(201).json({ batch });
  });

  app.patch('/api/material-batches/:id', requireAuth, authorize(store,'batches.manage'), async (req: AuthenticatedRequest, res) => {
    const batch = await store.findById('materialBatches', String(req.params.id));
    if (!batch || !scopeBatches(req.actor!, [batch]).length) throw new ManagementError('Material batch not found.',404);
    const reason = text(req.body.reason,'Reason');
    const transfers = (await store.all('transfers')).filter(item => item.batchId === batch.id);
    const listings = (await store.all('listings')).filter(item => item.batchId === batch.id);
    const action = req.body.action ?? 'edit';
    if (transfers.length || listings.some(item => ['Reserved','Completed'].includes(item.status))) throw new ManagementError('This batch has transfer history. Correct it through the transfer or recovery workflow.',409);
    const at = new Date().toISOString();
    let next: MaterialBatchRecord;
    const writes: RecordMutation[] = [];
    if (action === 'archive') {
      next = { ...batch, currentStatus:'Archived', archivedAt:at, updatedAt:at };
      for (const listing of listings) writes.push({ name:'listings', previous:listing, record:{...listing,status:'Closed'} });
      const offers = await store.all('offers');
      for (const offer of offers.filter(item => listings.some(listing => listing.id === item.listingId) && item.status === 'Pending')) {
        writes.push({ name:'offers', previous:offer, record:{...offer,status:'Declined',updatedAt:at} });
      }
    } else if (action === 'restore') {
      if (batch.currentStatus !== 'Archived') throw new ManagementError('Only archived batches can be restored.',409);
      next = { ...batch, currentStatus:'Recorded', archivedAt:null, updatedAt:at };
    } else {
      if (batch.currentStatus === 'Archived') throw new ManagementError('Restore this batch before editing.',409);
      const input = { ...batch, ...req.body };
      next = { ...batch, materialCategory:text(input.materialCategory,'Material category'), wasteSource:choice(input.wasteSource,wasteSources,'Waste source'),
        wasteForm:choice(input.wasteForm,wasteForms,'Waste form'), condition:choice(input.condition,conditions,'Condition'), circularPathway:choice(input.circularPathway,pathways,'Pathway'),
        city:text(input.city,'City'), region:text(input.region,'Region'), declaredWeightKg:number(input.declaredWeightKg,'Declared weight',0.001),
        currentWeightKg:number(input.declaredWeightKg,'Declared weight',0.001), weightStatus:choice(input.weightStatus,weights,'Weight status'), updatedAt:at };
      if (next.declaredWeightKg !== batch.declaredWeightKg || next.weightStatus !== batch.weightStatus) {
        writes.push({name:'measurements',record:{id:newId('MSR'),batchId:batch.id,transferId:null,stage:'Declaration',weightKg:number(next.declaredWeightKg,'Declared weight',0.001),status:choice(next.weightStatus,weights,'Weight status'),
          method:text(req.body.method,'Measurement method'),recordedBy:req.actor!.id,verifiedBy:next.weightStatus === 'Verified' ? req.actor!.id : null,timestamp:at,note:`Correction: ${reason}`}});
      }
      for (const listing of listings) writes.push({name:'listings',previous:listing,record:{...listing,textileType:next.materialCategory,wasteSource:next.wasteSource,wasteForm:next.wasteForm,
        quality:next.condition,circularPathway:next.circularPathway,quantityKg:next.declaredWeightKg,weightStatus:next.weightStatus,city:next.city,region:next.region}});
    }
    await saveManagement(store,req.actor!,[{name:'materialBatches',previous:batch,record:next},...writes],`batch.${action}`,batch.id,reason);
    res.json({batch:next});
  });

  app.patch('/api/barter/listings/:id',requireAuth,authorize(store,'listings.manage'),async (req: AuthenticatedRequest,res) => {
    const listing = await store.findById('listings',String(req.params.id));
    if (!listing) throw new ManagementError('Listing not found.',404);
    const reason = text(req.body.reason,'Reason');
    const transfers = (await store.all('transfers')).filter(item=>item.listingId===listing.id);
    const batch = await store.findById('materialBatches',listing.batchId);
    if (!batch) throw new ManagementError('Linked batch is missing.',409);
    if (!canModerateListing(listing)) throw new ManagementError('Disposed, reserved or pending-remainder stock cannot be reopened or moderated. Review the originating mobile lifecycle.',409);
    const status = choice(req.body.status ?? listing.status,['Open','Matched','Closed','Draft','Archived'],'Listing status');
    if (status==='Matched' && listing.status!=='Matched') throw new ManagementError('Matching status is assigned by the offer workflow.');
    if (status==='Draft' && listing.status!=='Draft' || status==='Archived' && listing.status!=='Archived') throw new ManagementError('Draft and archive states must originate from the mobile lifecycle.');
    if (['Reserved','Completed'].includes(listing.status) || transfers.length) throw new ManagementError('Use transfer administration for listings with transfer history.',409);
    if (batch.currentStatus === 'Archived' && status === 'Open') throw new ManagementError('Restore the linked batch before reopening.',409);
    const next = {...listing,title:text(req.body.title ?? listing.title,'Title'),description:text(req.body.description ?? listing.description,'Description',false),status};
    const writes: RecordMutation[] = [{name:'listings',previous:listing,record:next}];
    if (status !== listing.status && batch.currentStatus !== 'Archived') writes.push({name:'materialBatches',previous:batch,record:{...batch,currentStatus:status==='Open'?'Listed':status==='Matched'?'Reserved':'Closed',updatedAt:new Date().toISOString()}});
    if (status==='Closed') {
      for (const offer of (await store.all('offers')).filter(item=>item.listingId===listing.id && item.status==='Pending')) writes.push({name:'offers',previous:offer,record:{...offer,status:'Declined',updatedAt:new Date().toISOString()}});
    }
    await saveManagement(store,req.actor!,writes,'listing.moderated',listing.id,reason);
    res.json({listing:next});
  });

  app.patch('/api/recovery-records/:id',requireAuth,authorize(store,'recovery.manage'),async (req: AuthenticatedRequest,res: Response) => {
    const current = await store.findById('recoveryRecords',String(req.params.id));
    if (!current || !scopeRecoveryRecords(req.actor!,[current]).length) throw new ManagementError('Recovery record not found.',404);
    const reason = text(req.body.reason,'Reason');
    if (current.status === 'Reversed') throw new ManagementError('A reversed record is retained as history and cannot be changed.',409);
    const action = choice(req.body.action ?? 'edit',['edit','validate','flag','reverse','correct'],'Recovery action');
    if (current.status === 'Validated' && action === 'edit') throw new ManagementError('Correct a validated record by creating a replacement.',409);
    const next = {...current};
    if (action==='reverse') next.status='Reversed';
    if (action==='flag') next.status='Flagged';
    if (action==='validate') { next.status='Validated'; next.validatedBy=req.actor!.id; }
    if (action==='edit' || action==='correct') {
      const input={...current,...req.body};
      next.inputWeightKg=number(input.inputWeightKg,'Input weight',0.001);
      next.outputWeightKg=number(input.outputWeightKg,'Output weight');
      next.lossWeightKg=number(input.lossWeightKg ?? current.lossWeightKg ?? 0,'Processing loss');
      next.residualWeightKg=number(input.residualWeightKg ?? next.inputWeightKg-next.outputWeightKg-next.lossWeightKg,'Reject weight');
      if (Math.abs(next.inputWeightKg-next.outputWeightKg-next.residualWeightKg-next.lossWeightKg)>0.01) throw new ManagementError('Input must equal output plus rejects and processing loss.');
      next.stage=choice(input.stage,['Collection','Sorting','Processing','Recovery','Rejection'],'Stage');
      next.outcome=next.stage==='Rejection'?'Rejected':choice(input.outcome,pathways.filter(item=>item!=='For assessment'),'Outcome');
      next.status='Recorded'; next.validatedBy=null;
    }
    if (action==='validate' && (next.outputWeightKg===null || next.residualWeightKg===null || Math.abs(next.inputWeightKg-next.outputWeightKg-next.residualWeightKg-(next.lossWeightKg??0))>0.01)) throw new ManagementError('Validation requires balanced output, rejects and processing loss.');
    next.note=`${current.note}\n${action}: ${reason}`.trim();
    const writes: RecordMutation[] = [];
    if (action==='correct') {
      writes.push({name:'recoveryRecords',previous:current,record:{...current,status:'Reversed',note:`${current.note}\nSuperseded: ${reason}`}});
      next.id=newId('RCV'); next.timestamp=new Date().toISOString(); next.recordedBy=req.actor!.id;
      next.note=`Replaces ${current.id}. ${reason}`;
      writes.push({name:'recoveryRecords',record:next});
    } else writes.push({name:'recoveryRecords',previous:current,record:next});
    await saveManagement(store,req.actor!,writes,`recovery.${action}`,current.id,reason);
    res.json({record:next});
  });
}
