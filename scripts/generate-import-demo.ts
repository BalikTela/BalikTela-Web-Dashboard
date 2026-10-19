import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import ExcelJS from 'exceljs';
import { config } from 'dotenv';
import { IMPORT_COLUMNS, IMPORT_MAX_BYTES, IMPORT_MAX_ROWS } from '../shared/imports.js';
import { MATERIAL_CATEGORIES } from '../shared/workflows.js';
import { planImport, commitImport, importCsv } from '../server/imports.js';
import { aggregateMaterialEvidence } from '../server/materialEvidence.js';
import { createSeedData } from '../server/seed.js';
import { MemoryStore } from '../server/store.js';
import { SupabaseStore } from '../server/supabaseStore.js';
import type { DatabaseShape } from '../server/types.js';

// Live access is read-only; all import commits below target a disposable MemoryStore.
config({ path: '.env.supabase', quiet: true });
assert.ok(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
const live = new SupabaseStore(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
const regions = ['CENTRAL-VISAYAS', 'DAVAO-REGION', 'METRO-MANILA', 'WESTERN-VISAYAS'];
const users = await live.all('users');
const facilities = await live.all('facilities');
await live.close();
const partners = regions.map(region => {
  const source = users.find(user => user.id === `SYN-USR-PROD-${region}`);
  const recipient = users.find(user => user.id === `SYN-USR-REC-${region}`);
  const facility = facilities.find(item => item.id === `SYN-FAC-${region}`);
  assert.ok(source?.role === 'Producer' && source.accountStatus === 'Active' && source.city && source.region);
  assert.ok(recipient?.accountStatus === 'Active' && ['Recycler', 'BalikTela Hub', 'Upcycler'].includes(recipient.role));
  assert.ok(facility && facility.status !== 'Inactive' && facility.organizationId === recipient.organizationId);
  return { source, recipient, facility };
});
const seed = await createSeedData();
const admin = seed.users.find(user => user.role === 'Administrator')!;
const data = Object.fromEntries(Object.keys(seed).map(key => [key, []])) as unknown as DatabaseShape;
data.users = [admin, ...partners.flatMap(item => [item.source, item.recipient])];
data.facilities = partners.map(item => item.facility);
const memory = new MemoryStore(data);
const directory = resolve('test-results/demo-imports/20261019-v1');
await mkdir(directory, { recursive: true });
const round = (value: number) => Number(value.toFixed(6));
const stats = async () => aggregateMaterialEvidence(await memory.all('materialBatches'), await memory.all('transfers'),
  await memory.all('recoveryRecords'), { measurements: await memory.all('measurements'), listings: await memory.all('listings') });
const totals: Array<Record<string, string | number>> = [];
const workbook = new ExcelJS.Workbook();
const files: Array<Record<string, unknown>> = [];
const now = new Date();
assert.ok(now.getTime() > Date.parse('2026-10-18T12:00:06+08:00'), 'Dataset must not contain future events.');
for (let part = 1; part <= 3; part++) {
  const sheet = workbook.addWorksheet(`Part ${part}`);
  sheet.addRow([...IMPORT_COLUMNS]);
  for (let index = 0; index < IMPORT_MAX_ROWS; index++) {
    const partner = partners[index % partners.length];
    const month = index % 3;
    const day = 1 + Math.floor(index / 3) % (month === 2 ? 18 : month === 1 ? 30 : 31);
    const declared = 300 + part * 100 + month * 200 + (Math.floor(index / 3) % 20) * 10;
    const collected = round(declared * 0.9), sorted = round(collected * 0.9), output = round(sorted * 0.8);
    sheet.addRow([
      `DEMO-IMPORT-20261019-V1-P${part}-${String(index + 1).padStart(4, '0')}`,
      `2026-${String(month + 8).padStart(2, '0')}-${String(day).padStart(2, '0')}T12:00:00+08:00`,
      partner.source.id, partner.recipient.id, partner.facility.id, MATERIAL_CATEGORIES[index % MATERIAL_CATEGORIES.length],
      declared, collected, sorted, Math.floor(index / 3) % 3 === 0 ? 'Reuse' : 'Recycling', output,
    ]);
  }
  const csv = (await workbook.csv.writeBuffer({ sheetName: sheet.name })).toString();
  assert.ok(Buffer.byteLength(csv) <= IMPORT_MAX_BYTES);
  assert.equal(importCsv({ csvChunks: csv.match(/[\s\S]{1,8000}/g) }), csv);
  const plan = await planImport(memory, admin, csv, now);
  assert.equal(plan.preview.valid, true, JSON.stringify(plan.preview.rows.filter(row => row.status === 'Invalid')));
  assert.equal(plan.preview.newRows, IMPORT_MAX_ROWS);
  const before = await stats();
  const result = await commitImport(memory, admin, csv, plan.preview.previewHash, 'Disposable memory-only demo validation', now);
  assert.ok(result.complete && result.importedRows === IMPORT_MAX_ROWS);
  const after = await stats();
  assert.equal(round(after.generatedKg - before.generatedKg), plan.preview.totals.declaredKg);
  assert.equal(round(after.collectedKg - before.collectedKg), plan.preview.totals.collectedKg);
  assert.equal(round(after.reusedKg - before.reusedKg), plan.preview.totals.reusedKg);
  assert.equal(round(after.recycledKg - before.recycledKg), plan.preview.totals.recycledKg);
  assert.equal(after.transactionCount - before.transactionCount, IMPORT_MAX_ROWS);
  assert.equal(round(after.completedKg - before.completedKg), plan.preview.totals.collectedKg);
  assert.equal(after.collectionConflicts, 0); assert.equal(after.outcomeConflicts, 0);
  assert.equal(after.diversionRate, 72);
  const retry = await planImport(memory, admin, csv, now);
  assert.ok(retry.preview.valid && retry.preview.newRows === 0 && retry.preview.skippedRows === IMPORT_MAX_ROWS);
  const filename = `baliktela-demo-part-${part}-500-rows.csv`;
  await writeFile(resolve(directory, filename), csv);
  const summary = { file: filename, rows: IMPORT_MAX_ROWS, declared_t: round(plan.preview.totals.declaredKg / 1000),
    collected_t: round(plan.preview.totals.collectedKg / 1000), recycling_t: round(plan.preview.totals.recycledKg / 1000),
    reuse_t: round(plan.preview.totals.reusedKg / 1000),
    recovered_t: round((plan.preview.totals.recycledKg + plan.preview.totals.reusedKg) / 1000),
    completed_transfers: IMPORT_MAX_ROWS, completed_transfer_t: round(plan.preview.totals.collectedKg / 1000) };
  totals.push(summary);
  files.push({ ...summary, bytes: Buffer.byteLength(csv), previewValid: true, duplicateRetrySkipped: IMPORT_MAX_ROWS });
}
const summaryWorkbook = new ExcelJS.Workbook();
const summarySheet = summaryWorkbook.addWorksheet('Expected changes');
summarySheet.addRow(Object.keys(totals[0]));
for (const total of totals) summarySheet.addRow(Object.values(total));
await summaryWorkbook.csv.writeFile(resolve(directory, 'expected-changes-not-for-import.csv'));
const final = await stats();
await writeFile(resolve(directory, 'validation.json'), JSON.stringify({ generatedAt: now.toISOString(), liveDatabaseWrites: 0,
  rows: 1500, files, aggregate: { declaredKg: final.generatedKg, collectedKg: final.collectedKg,
    reusedKg: final.reusedKg, recycledKg: final.recycledKg, completedTransfers: final.transactionCount,
    importedCohortRecoveryPercent: final.diversionRate }, validation: 'Real importer preview, commit, mass reconciliation, and duplicate retry tested in disposable memory only.' }, null, 2));
await writeFile(resolve(directory, 'READ-ME.txt'), [
  'BALIKTELAPH SYNTHETIC IMPORT TEST - 1,500 DEMO LIFECYCLES',
  '',
  'Nothing has been imported into your live database by the generator.',
  'Start with baliktela-demo-part-1-500-rows.csv. Parts 2 and 3 are optional additional load.',
  'Each file contains 500 different batches, completed transfers, and final Reuse/Recycling outcomes.',
  'These are illustrative synthetic records, not measurements of actual textiles.',
  '',
  'HOW TO TEST',
  '1. Sign in to the web dashboard as Administrator.',
  '2. Record the Overview totals. Choose Last 3 calendar months (Aug-Oct 2026), all regions, all textiles, and clear other scope filters.',
  '3. Go to Material Registry > Import CSV and choose part 1.',
  '4. Preview: expect 500 new, 0 invalid, and 0 previously imported (first import only).',
  '5. Enter an import reason, confirm synthetic data, and import.',
  '6. Wait for completion, then compare Overview against expected-changes-not-for-import.csv.',
  '7. Optional: import parts 2 and 3 one at a time, checking after each.',
  '8. Re-preview the same unchanged file: expect 500 already imported and no extra totals.',
  '',
  'IMPORTANT',
  'Only the three files named baliktela-demo-part-* are import files. Do not import the expected-changes summary.',
  'CSV weights are kilograms; expected changes are metric tonnes. 1 t = 1,000 kg.',
  'Rows use existing synthetic Producer/Recycler/facility IDs in four regions, not real mobile identities.',
  'Dates run Aug 1-Oct 18, 2026. Later date filters may exclude these records.',
  'The imported cohort recovery share is 72%; the combined dashboard percentage is recalculated, not increased by 72 points.',
  'Combined share = (previous matched recovery kg + imported recovered kg) / (previous validated collection kg + imported collected kg) x 100, if evidence checks pass.',
  'No new users, rewards, Hub disposal records, or established landfill-diversion evidence are created.',
  'Monthly active-user summaries and the bundled predictive model do not automatically retrain from these imports.',
  'The importer adds demo records to whichever database your web server uses; it is not a temporary preview after confirmation.',
  'Keep the files unchanged for duplicate protection. Changed values with the same external IDs are rejected, not updated.',
  'Imports commit in five-row chunks. If interrupted, retry the same file to skip completed chunks.',
  'A single 500-row file expands into thousands of linked records; complete and check it before adding more load.',
  'No automatic deletion/undo is included. Prefer a staging database for large load tests.',
  '',
  'Validation: all 1,500 rows passed the actual importer in memory; no mass conflicts; re-import skipped all rows.',
].join('\n') + '\n');
console.log(JSON.stringify({ directory, liveDatabaseWrites: 0, files, totalRows: final.transactionCount, importedRecoveryPercent: final.diversionRate }));
