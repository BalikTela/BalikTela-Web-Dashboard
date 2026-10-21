import { useContext, useEffect, useRef } from 'react';
import { PageActivity } from './PageActivity';

const refreshIntervalMs = 15 * 60 * 1_000;

export function useRecordRefresh(load: () => void | Promise<void>, prefixes: string[]) {
  const latest=useRef(load);
  const active = useContext(PageActivity);
  const wasActive = useRef(active);
  latest.current=load;
  const key=prefixes.join('|');
  useEffect(()=>{
    let running = false;
    let lastRefresh = 0;
    const refresh = () => {
      if (!active || running || document.visibilityState !== 'visible' || !navigator.onLine || document.querySelector('[role="dialog"] form')) return;
      if (Date.now() - lastRefresh < 2_000) return;
      running = true;
      lastRefresh = Date.now();
      void Promise.resolve().then(() => latest.current()).catch(() => undefined).finally(() => { running = false; });
    };
    const changed=(event: Event)=>{
      const path=String((event as CustomEvent).detail ?? '');
      if(active && key.split('|').some(prefix=>path.startsWith(prefix))) void latest.current();
    };
    if (active && !wasActive.current) refresh();
    wasActive.current = active;
    const timer = active ? window.setInterval(refresh, refreshIntervalMs) : undefined;
    window.addEventListener('baliktela:records-changed',changed);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('online', refresh);
    return ()=>{ window.clearInterval(timer); window.removeEventListener('baliktela:records-changed',changed); window.removeEventListener('focus',refresh); document.removeEventListener('visibilitychange',refresh); window.removeEventListener('online',refresh); };
  },[key, active]);
}
