const caches = new Set<{ clear(): void }>();
window.addEventListener('baliktela:auth-cleared', () => caches.forEach(cache => cache.clear()));

export function createSessionCache<K, V>() {
  const cache = new Map<K, V>();
  caches.add(cache);
  return cache;
}
