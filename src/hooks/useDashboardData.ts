import { useEffect, useMemo, useRef, useState } from 'react';
import { getDashboardData } from '../services/dashboardService';
import type { Filters } from '../types';

type DashboardData = Awaited<ReturnType<typeof getDashboardData>>;
type CacheEntry = { data: DashboardData; cachedAt: number };

const clientCache = new Map<string, CacheEntry>();
const freshForMs = 30_000;
const maximumEntries = 24;

function cacheKey(filters: Filters, scopeKey: string) {
  return JSON.stringify({ scopeKey, filters });
}

function remember(key: string, data: DashboardData) {
  clientCache.delete(key);
  clientCache.set(key, { data, cachedAt: Date.now() });
  while (clientCache.size > maximumEntries) {
    const oldest = clientCache.keys().next().value;
    if (oldest === undefined) break;
    clientCache.delete(oldest);
  }
}

export function useDashboardData(filters: Filters, scopeKey: string, enabled = true) {
  const [revision,setRevision]=useState(0);
  const [data, setData] = useState<DashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dataRef = useRef<DashboardData | null>(null);
  const key = useMemo(() => cacheKey(filters, scopeKey), [filters, scopeKey]);

  useEffect(()=>{
    const invalidate=()=>{ clientCache.clear();setRevision(value=>value+1); };
    window.addEventListener('baliktela:records-changed',invalidate);
    return ()=>window.removeEventListener('baliktela:records-changed',invalidate);
  },[]);

  useEffect(() => { dataRef.current = data; }, [data]);

  useEffect(() => {
    if (!enabled) {
      setIsLoading(false);
      setIsRefreshing(false);
      return;
    }

    let active = true;
    const controller = new AbortController();
    const cached = clientCache.get(key);
    const displayData = cached?.data ?? dataRef.current;
    if (cached) setData(cached.data);
    setIsLoading(!displayData);
    setIsRefreshing(Boolean(displayData));
    setError(null);

    if (cached && Date.now() - cached.cachedAt < freshForMs) {
      setIsLoading(false);
      setIsRefreshing(false);
      return () => { active = false; controller.abort(); };
    }

    const timer = window.setTimeout(() => {
      getDashboardData(filters, controller.signal)
        .then((result) => {
          if (!active) return;
          remember(key, result);
          setData(result);
          setError(null);
        })
        .catch((requestError: Error) => {
          if (!active || requestError.name === 'AbortError') return;
          setError(requestError.message);
          if (!displayData) setData(null);
        })
        .finally(() => {
          if (active) {
            setIsLoading(false);
            setIsRefreshing(false);
          }
        });
    }, 200);

    return () => {
      active = false;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [enabled, filters, key, revision]);

  return { data, isLoading, isRefreshing, error };
}
