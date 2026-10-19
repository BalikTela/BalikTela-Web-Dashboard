export const IMPORT_COLUMNS = ['external_id', 'registered_at', 'source_user_id', 'recipient_user_id', 'facility_id', 'material_category', 'declared_kg', 'collected_kg', 'sorted_kg', 'outcome', 'outcome_kg'] as const;
export const IMPORT_MAX_ROWS = 500;
export const IMPORT_MAX_BYTES = 256000;
export const IMPORT_COMMIT_ROWS = 25;
export const IMPORT_RECORD_NAMES = ['materialBatches', 'listings', 'offers', 'transfers', 'measurements', 'recoveryRecords'] as const;
export type ImportRecordName = typeof IMPORT_RECORD_NAMES[number];
export interface ImportExistingRecord { name: ImportRecordName; id: string; isDemo?: boolean; description?: string }
export interface ImportRecordLookup { name: ImportRecordName; ids: string[] }
export interface ImportPreview {
  previewHash: string; valid: boolean; totalRows: number; newRows: number; skippedRows: number;
  totals: { declaredKg: number; collectedKg: number; reusedKg: number; recycledKg: number };
  rows: Array<{ row: number; externalId: string; batchId: string; status: 'New' | 'Already imported' | 'Invalid'; message: string }>;
}
export interface ImportResult {
  complete: boolean; importedRows: number; skippedRows: number; message: string;
  nextRow?: number; totalRows?: number;
}
export interface ImportOptions {
  producers: Array<{ id: string; name: string; region: string }>;
  recipients: Array<{ id: string; name: string; organizationId: string | null }>;
  facilities: Array<{ id: string; name: string; organizationId: string }>;
}
