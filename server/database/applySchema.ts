import type { Db, Document } from 'mongodb';
import { CORE_COLLECTION_NAMES, DATABASE_COLLECTIONS, DATABASE_SCHEMA_VERSION } from './schema.js';

interface SchemaVersionDocument extends Document {
  _id: string;
  version: string;
  status: 'active' | 'superseded' | 'rolled_back';
  applied_at: Date;
  applied_by: string;
  notes: string;
}

export interface SchemaPlanEntry {
  collection: string;
  action: 'create' | 'update';
  indexes: string[];
}

export async function planDatabaseSchema(db: Db): Promise<SchemaPlanEntry[]> {
  const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map(({ name }) => name));
  return DATABASE_COLLECTIONS.map((definition) => ({
    collection: definition.name,
    action: existing.has(definition.name) ? 'update' : 'create',
    indexes: definition.indexes.map((index) => String(index.name)),
  }));
}

export async function applyDatabaseSchema(db: Db, appliedBy: string) {
  const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map(({ name }) => name));

  for (const definition of DATABASE_COLLECTIONS) {
    if (existing.has(definition.name)) {
      await db.command({
        collMod: definition.name,
        validator: definition.validator,
        validationLevel: 'strict',
        validationAction: 'error',
      });
    } else {
      await db.createCollection(definition.name, {
        validator: definition.validator,
        validationLevel: 'strict',
        validationAction: 'error',
      });
    }

    if (definition.indexes.length) await db.collection(definition.name).createIndexes(definition.indexes);

    const expectedIndexes = new Set(['_id_', ...definition.indexes.map((index) => String(index.name))]);
    const managedPrefixes = ['uq_', 'idx_', 'geo_', 'ttl_', 'text_'];
    const existingIndexes = await db.collection(definition.name).listIndexes().toArray();
    for (const index of existingIndexes) {
      if (!expectedIndexes.has(index.name) && managedPrefixes.some((prefix) => index.name.startsWith(prefix))) {
        await db.collection(definition.name).dropIndex(index.name);
      }
    }
  }

  await activateSchemaVersion(db, appliedBy, 'BalikTela shared web/mobile material-first database contract.');
}

export async function applyAdditiveDatabaseSchema(db: Db, appliedBy: string) {
  const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map(({ name }) => name));

  for (const definition of DATABASE_COLLECTIONS) {
    if (existing.has(definition.name)) continue;
    await db.createCollection(definition.name, {
      validator: definition.validator,
      validationLevel: 'strict',
      validationAction: 'error',
    });
    if (definition.indexes.length) await db.collection(definition.name).createIndexes(definition.indexes);
  }

  await activateSchemaVersion(db, appliedBy, 'Additive authentication schema application for a restricted Atlas deployment user.');
}

async function activateSchemaVersion(db: Db, appliedBy: string, notes: string) {
  const versions = db.collection<SchemaVersionDocument>('schema_versions');
  await versions.updateMany(
    { status: 'active', version: { $ne: DATABASE_SCHEMA_VERSION } },
    { $set: { status: 'superseded' } },
  );
  await versions.updateOne(
    { _id: DATABASE_SCHEMA_VERSION },
    {
      $set: {
        version: DATABASE_SCHEMA_VERSION,
        status: 'active',
        applied_at: new Date(),
        applied_by: appliedBy,
        notes,
      },
    },
    { upsert: true },
  );
}

export async function inspectDatabaseSchema(db: Db) {
  const existingCollections = await db.listCollections({}, { nameOnly: true }).toArray();
  const existing = new Set(existingCollections.map(({ name }) => name));
  const missing = CORE_COLLECTION_NAMES.filter((name) => !existing.has(name));
  const extra = [...existing].filter((name) => !CORE_COLLECTION_NAMES.includes(name));
  const activeVersion = await db.collection('schema_versions').findOne({ status: 'active' }, { projection: { _id: 0, version: 1, applied_at: 1, applied_by: 1 } });
  return { expectedVersion: DATABASE_SCHEMA_VERSION, activeVersion: activeVersion as Document | null, missing, extra };
}
