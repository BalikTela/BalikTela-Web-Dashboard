import 'dotenv/config';
import { MongoClient } from 'mongodb';
import { applyAdditiveDatabaseSchema, applyDatabaseSchema, inspectDatabaseSchema, planDatabaseSchema } from '../server/database/applySchema.js';
import { mongoClientOptionsFromEnv } from '../server/database/mongoClientOptions.js';
import { DATABASE_SCHEMA_VERSION, LEGACY_COLLECTION_DECISIONS } from '../server/database/schema.js';

const uri = process.env.MONGODB_URI;
const databaseName = process.env.MONGODB_DB;
const apply = process.argv.includes('--apply');
const additive = process.argv.includes('--additive');

if (!uri || !databaseName) {
  console.error('MONGODB_URI and MONGODB_DB are required.');
  process.exit(1);
}

if ((apply || additive) && process.env.MONGODB_SCHEMA_APPLY !== 'true') {
  console.error('Refusing to modify the database. Set MONGODB_SCHEMA_APPLY=true for an intentional schema application.');
  process.exit(1);
}

const client = new MongoClient(uri, mongoClientOptionsFromEnv());

try {
  await client.connect();
  const db = client.db(databaseName);

  if (apply || additive) {
    const plan = await planDatabaseSchema(db);
    console.log(`Applying BalikTela database schema ${DATABASE_SCHEMA_VERSION} to ${databaseName}...`);
    for (const item of plan) console.log(`- ${item.action} ${item.collection} (${item.indexes.length} indexes)`);
    if (additive) await applyAdditiveDatabaseSchema(db, process.env.MONGODB_SCHEMA_APPLIED_BY ?? 'database-schema-script');
    else await applyDatabaseSchema(db, process.env.MONGODB_SCHEMA_APPLIED_BY ?? 'database-schema-script');
    console.log(`Schema ${DATABASE_SCHEMA_VERSION} applied successfully.`);
  }

  const inspection = await inspectDatabaseSchema(db);
  console.log(JSON.stringify({ database: databaseName, ...inspection, legacyCollections: LEGACY_COLLECTION_DECISIONS }, null, 2));
  if (!apply && !additive && (inspection.missing.length || inspection.activeVersion?.version !== DATABASE_SCHEMA_VERSION)) process.exitCode = 2;
} finally {
  await client.close();
}
