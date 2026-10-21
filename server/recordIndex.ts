export function groupRecords<T>(records: readonly T[], key: (record: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const record of records) {
    const id = key(record);
    const group = groups.get(id);
    if (group) group.push(record);
    else groups.set(id, [record]);
  }
  return groups;
}
