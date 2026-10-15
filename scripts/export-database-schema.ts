import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { CORE_COLLECTION_NAMES, DATABASE_COLLECTIONS, DATABASE_SCHEMA_VERSION, LEGACY_COLLECTION_DECISIONS, WEB_PERSISTENCE_COLLECTION_MAP } from '../server/database/schema.js';

const output = fileURLToPath(new URL('../docs/BalikTela_Database_Schema_v1.json', import.meta.url));
const contract = {
  project: 'BalikTelaPH',
  schemaVersion: DATABASE_SCHEMA_VERSION,
  identifierStrategy: 'String identifiers in MongoDB _id and all reference fields',
  timestampStrategy: 'BSON Date values with snake_case field names',
  primaryMassUnit: 'kg',
  collections: DATABASE_COLLECTIONS,
  collectionNames: CORE_COLLECTION_NAMES,
  webPersistenceCollectionMap: WEB_PERSISTENCE_COLLECTION_MAP,
  legacyCollectionDecisions: LEGACY_COLLECTION_DECISIONS,
};

await writeFile(output, `${JSON.stringify(contract, null, 2)}\n`, 'utf8');
console.log(`Wrote ${output}`);
