export const IMPORT_COLUMNS = ['external_id', 'registered_at', 'source_user_id', 'recipient_user_id', 'facility_id', 'material_category', 'declared_kg', 'collected_kg', 'sorted_kg', 'outcome', 'outcome_kg'] as const;
export const IMPORT_MAX_ROWS = 500;
export const IMPORT_MAX_BYTES = 256000;
export interface ImportPreview {
  previewHash: string; valid: boolean; totalRows: number; newRows: number; skippedRows: number;
  totals: { declaredKg: number; collectedKg: number; reusedKg: number; recycledKg: number };
  rows: Array<{ row: number; externalId: string; batchId: string; status: 'New' | 'Already imported' | 'Invalid'; message: string }>;
}
export interface ImportResult { complete: boolean; importedRows: number; skippedRows: number; message: string }
export interface ImportOptions {
  producers: Array<{ id: string; name: string; region: string }>;
  recipients: Array<{ id: string; name: string; organizationId: string | null }>;
  facilities: Array<{ id: string; name: string; organizationId: string }>;
}
