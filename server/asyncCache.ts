import type { UserRecord } from './types.js';

export type CacheStatus = 'HIT' | 'MISS' | 'COALESCED';

export class AsyncTtlCache<T> {
  private entries = new Map<string, { value: T; expiresAt: number }>();
  private pending = new Map<string, Promise<T>>();
  private generation=0;

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number,
    private readonly now: () => number = Date.now,
  ) {}

  async getOrCreate(key: string, create: () => Promise<T>): Promise<{ value: T; status: CacheStatus }> {
    const cached = this.entries.get(key);
    if (cached && cached.expiresAt > this.now()) {
      this.entries.delete(key);
      this.entries.set(key, cached);
      return { value: cached.value, status: 'HIT' };
    }
    if (cached) this.entries.delete(key);

    const inFlight = this.pending.get(key);
    if (inFlight) return { value: await inFlight, status: 'COALESCED' };

    const generation=this.generation;
    const promise = create();
    this.pending.set(key, promise);
    try {
      const value = await promise;
      if(generation===this.generation) {
        this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
        this.evictOverflow();
      }
      return { value, status: 'MISS' };
    } finally {
      if(this.pending.get(key)===promise)this.pending.delete(key);
    }
  }

  clear() {
    this.entries.clear();
    this.pending.clear();
    this.generation+=1;
  }

  get size() {
    return this.entries.size;
  }

  private evictOverflow() {
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) return;
      this.entries.delete(oldest);
    }
  }
}

export function dashboardAnalyticsCacheKey(actor: UserRecord, query: Record<string, unknown>) {
  return JSON.stringify({
    actor: actor.id,
    role: actor.role,
    hubOperator: actor.webHubOperator === true,
    organizationId: actor.organizationId,
    scope: {
      aggregateOnly: actor.scope.aggregateOnly,
      canExport: actor.scope.canExport,
      facilityIds: [...actor.scope.facilityIds].sort(),
      organizationIds: [...actor.scope.organizationIds].sort(),
      regions: [...actor.scope.regions].sort(),
    },
    query: Object.fromEntries(Object.entries(query)
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [key, Array.isArray(value) ? [...value].map(String).sort() : String(value)])),
  });
}
