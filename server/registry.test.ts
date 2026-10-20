import assert from 'node:assert/strict';
import test from 'node:test';
import { facilityValues, organizationValues } from './management.js';
import { decodeRecord, encodeRecord } from './database/codecs.js';
import { canonicalMutations } from './database/mutations.js';
import { createSeedData } from './seed.js';
import { ORGANIZATION_TYPES, organizationType } from '../shared/registry.js';
import { DATABASE_COLLECTIONS } from './database/schema.js';

const details = { name: 'Registered organization', type: 'Producer', city: 'Manila', region: 'Metro Manila' };

test('organization types have one shared canonical option each and round-trip without a second vocabulary',()=>{
  assert.equal(ORGANIZATION_TYPES.length,10);assert.equal(new Set(ORGANIZATION_TYPES).size,10);
  const schema=DATABASE_COLLECTIONS.find(item=>item.name==='organizations')!;
  assert.deepEqual(schema.validator.$jsonSchema.properties.type.enum,[...ORGANIZATION_TYPES]);
  for(const type of ORGANIZATION_TYPES){
    const organization=organizationValues({...details,type});
    assert.equal(organization.type,type);
    assert.equal(encodeRecord('organizations',organization).type,type);
    assert.equal(decodeRecord('organizations',encodeRecord('organizations',organization)).type,type);
  }
  for(const type of ['Consumer','BalikTela Hub','Administrator','Researcher','__proto__','constructor','',null,42]){
    assert.equal(organizationType(type),null);
    assert.throws(()=>organizationValues({...details,type}),/organization type/);
  }
});

test('School is a distinct organization type, not an alias for Research institution',()=>{
  assert.equal(organizationType('School'),'School');
  assert.equal(organizationType('Research institution'),'Research institution');
  const school=organizationValues({...details,type:'School'});
  assert.equal(decodeRecord('organizations',encodeRecord('organizations',school)).type,'School');
  const edited=organizationValues({contactEmail:'school@example.test'},school);
  assert.equal(edited.type,'School');assert.equal(edited.id,school.id);
});

test('legacy organization type aliases normalize without changing identity, provenance or unrelated stored fields',async()=>{
  const aliases=[['Producer','Producer/Retailer'],['Research','Research institution'],['Government','Government agency'],['NGO','NGO/Community'],['LGU/Collection Point','LGU/MRF']];
  const seed=await createSeedData();
  for(const [legacy,canonical] of aliases){
    assert.equal(organizationType(` ${legacy} `),canonical);
    const current={...seed.organizations[0],type:legacy};
    const updated=organizationValues({contactEmail:'corrected@example.test'},current);
    assert.equal(updated.type,canonical);assert.equal(updated.id,current.id);assert.equal(updated.recordLabel,current.recordLabel);
    const mutation=canonicalMutations([{name:'organizations',previous:current,record:updated}])[0];
    assert.equal(Object.hasOwn(mutation.values,'type'),false,'Legacy alias already encodes to the same shared database type.');
    assert.equal(Object.hasOwn(mutation.values,'record_label'),false);
    assert.equal(decodeRecord('organizations',{...encodeRecord('organizations',current),type:legacy}).type,canonical);
  }
  assert.equal(organizationType('Unrecognized legacy type'),null,'Do not guess an unrelated institutional classification.');
});

test('new registry records default to operational and pending review and persist those defaults', () => {
  const organization = organizationValues(details);
  assert.equal(organization.recordLabel, 'Operational');
  assert.equal(organization.status, 'Pending review');
  assert.equal(organization.verification, 'Pending review');
  const document = encodeRecord('organizations', organization);
  assert.equal(document.record_label, 'operational');
  assert.equal(document.status, 'prospective');
  assert.equal(document.verification_status, 'pending');
  assert.equal(decodeRecord('organizations', document).recordLabel, 'Operational');
  const hub = facilityValues({ ...details, type: 'Collection point', organizationId: organization.id, storageCapacityKg:1500 });
  assert.equal(hub.storageCapacityKg,1500);
  assert.equal(hub.isDemo, false);
  assert.equal(hub.verification, 'Pending review');
  assert.equal(decodeRecord('facilities', encodeRecord('facilities', hub)).isDemo, false);
});

test('operational organization activation and registry verification round-trip canonical statuses', () => {
  const organization = organizationValues({ ...details, status: 'Active', verification: 'Verified' });
  assert.equal(encodeRecord('organizations', organization).status, 'active');
  assert.equal(decodeRecord('organizations', encodeRecord('organizations', organization)).status, 'Active');
  for (const verification of ['Pending review', 'Verified', 'Rejected', 'Suspended'] as const) {
    const org = organizationValues({ ...details, verification });
    assert.equal(decodeRecord('organizations', encodeRecord('organizations', org)).verification, verification);
    const hub = facilityValues({ ...details, type: 'Collection point', organizationId: org.id, verification, storageCapacityKg:1000 });
    assert.equal(decodeRecord('facilities', encodeRecord('facilities', hub)).verification, verification);
  }
  assert.throws(() => organizationValues({ ...details, status: 'Invalid' }));
  assert.throws(() => facilityValues({ ...details, organizationId: organization.id, verification: 'Invalid' }));
});

test('registration rejects demo flags and edits cannot recast existing provenance', async () => {
  for (const recordLabel of ['Demo', 'Sample']) assert.throws(() => organizationValues({ ...details, recordLabel }), /classification/);
  assert.throws(() => facilityValues({ ...details, organizationId: 'ORG', isDemo: true }), /classification/);
  const seed = await createSeedData();
  for (const current of seed.organizations) {
    const updated = organizationValues({ name: 'Renamed registry record' }, current);
    assert.equal(updated.recordLabel, current.recordLabel);
    assert.equal(decodeRecord('organizations', encodeRecord('organizations', updated)).recordLabel, current.recordLabel);
    assert.throws(() => organizationValues({ recordLabel: 'Operational' }, current), /classification/);
    const mutation = canonicalMutations([{ name: 'organizations', previous: current, record: updated }])[0];
    assert.equal(Object.hasOwn(mutation.values, 'record_label'), false);
    assert.equal(Object.hasOwn(mutation.values, 'verification_status'), false);
  }
  const hub = seed.facilities[0];
  const updated = facilityValues({ name: 'Renamed Hub' }, hub);
  assert.equal(updated.isDemo, hub.isDemo);
  assert.throws(() => facilityValues({ isDemo: false }, hub), /classification/);
  const mutation = canonicalMutations([{ name: 'facilities', previous: hub, record: updated }])[0];
  assert.equal(Object.hasOwn(mutation.values, 'is_demo'), false);
  assert.equal(Object.hasOwn(mutation.values, 'verification_status'), false);
});

test('storage settings are positive kilograms, persist independently and never reset legacy intake or throughput',async()=>{
  const hubDetails={...details,type:'Collection point',organizationId:'ORG'};
  for(const storageCapacityKg of [undefined,null,'',0,-1,NaN,Infinity,-Infinity,0.0001])
    assert.throws(()=>facilityValues({...hubDetails,storageCapacityKg}),/Storage capacity/);
  const hub=facilityValues({...hubDetails,storageCapacityKg:1500,monthlyCapacityKg:9000,currentIntakeKg:7000});
  assert.equal(hub.monthlyCapacityKg,0);assert.equal(hub.currentIntakeKg,0);
  const document=encodeRecord('facilities',hub);
  assert.equal(document.storage_capacity_kg,1500);
  assert.equal(decodeRecord('facilities',document).storageCapacityKg,1500);
  const legacy=(await createSeedData()).facilities[0];
  const updated=facilityValues({storageCapacityKg:2000,monthlyCapacityKg:0,currentIntakeKg:0},legacy);
  assert.equal(updated.monthlyCapacityKg,legacy.monthlyCapacityKg);assert.equal(updated.currentIntakeKg,legacy.currentIntakeKg);
  const write=canonicalMutations([{name:'facilities',previous:legacy,record:updated}])[0];
  assert.equal(write.values.storage_capacity_kg,2000);
  assert.equal(Object.hasOwn(write.values,'monthly_capacity_kg'),false);assert.equal(Object.hasOwn(write.values,'current_intake_kg'),false);
});
