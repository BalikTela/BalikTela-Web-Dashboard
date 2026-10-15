import { lookup as systemLookup } from 'node:dns';
import type { MongoClientOptions } from 'mongodb';

export function mongoClientOptionsFromEnv(): MongoClientOptions {
  const configured = process.env.MONGODB_HOST_OVERRIDES;
  if (!configured) return {};
  const overrides = JSON.parse(configured) as Record<string, string>;

  return {
    lookup: ((hostname: string, options: unknown, callback: (...args: unknown[]) => void) => {
      const address = overrides[hostname];
      if (!address) return systemLookup(hostname, options as never, callback as never);
      const all = typeof options === 'object' && options !== null && 'all' in options && Boolean((options as { all?: boolean }).all);
      if (all) callback(null, [{ address, family: 4 }]);
      else callback(null, address, 4);
    }) as MongoClientOptions['lookup'],
  };
}
