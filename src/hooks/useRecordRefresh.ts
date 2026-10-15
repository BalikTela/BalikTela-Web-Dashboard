import { useEffect, useRef } from 'react';

export function useRecordRefresh(load: () => void | Promise<void>, prefixes: string[]) {
  const latest=useRef(load);
  latest.current=load;
  const key=prefixes.join('|');
  useEffect(()=>{
    const changed=(event: Event)=>{
      const path=String((event as CustomEvent).detail ?? '');
      if(key.split('|').some(prefix=>path.startsWith(prefix))) void latest.current();
    };
    window.addEventListener('baliktela:records-changed',changed);
    return ()=>window.removeEventListener('baliktela:records-changed',changed);
  },[key]);
}
