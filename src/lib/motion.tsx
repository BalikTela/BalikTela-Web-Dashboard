import { createContext, useContext, useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';

const preference = '(prefers-reduced-motion: reduce)';
const subscribe = (listener: () => void) => {
  const media = window.matchMedia(preference);
  media.addEventListener('change', listener);
  return () => media.removeEventListener('change', listener);
};
const snapshot = () => window.matchMedia(preference).matches;
export const motionTiming = { feedback: 160, entry: 280, chart: 360, stagger: 28 } as const;
export const motionEase = 'cubic-bezier(0.22, 1, 0.36, 1)';

export function useReducedMotion() {
  return useSyncExternalStore(subscribe, snapshot, () => true);
}

const PageActivity = createContext(true);
export const usePageActivity = () => useContext(PageActivity);

export function MotionPage({ active, children }: { active: boolean; children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const revealed = useRef(new WeakSet<Element>());
  const reduced = useReducedMotion();

  useEffect(() => {
    const container = root.current;
    if (!container || !active || reduced) return;
    const animations = new Set<Animation>();
    const observed = new WeakSet<Element>();
    let frame = 0;
    const observer = new IntersectionObserver(entries => {
      let order = 0;
      for (const entry of entries) {
        if (!entry.isIntersecting || revealed.current.has(entry.target)) continue;
        const element = entry.target;
        revealed.current.add(element);
        observer.unobserve(element);
        const line = element.matches('.sparkline-line');
        const progress = element.matches('.progress-fill');
        const marker = element.matches('.geo-pin-dot');
        const animation = element.animate(
          line ? [{ strokeDashoffset: '1' }, { strokeDashoffset: '0' }]
            : progress ? [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }]
              : marker ? [{ opacity: 0.4, scale: 0.8 }, { opacity: 1, scale: 1 }]
              : [{ opacity: 0.45, translate: '0 6px' }, { opacity: 1, translate: '0 0' }],
          { duration: line ? 540 : progress ? motionTiming.chart : motionTiming.entry,
            delay: Math.min(order++, 5) * motionTiming.stagger, easing: motionEase },
        );
        animations.add(animation);
        animation.finished.then(() => animations.delete(animation), () => animations.delete(animation));
      }
    }, { threshold: 0.05 });
    const scan = () => {
      frame = 0;
      container.querySelectorAll('.surface-panel, .dashboard-panel, .stagger-grid > *, .data-row, [data-motion-reveal], .circular-flow-step, .progress-fill, .sparkline-line, .geo-pin-dot').forEach(element => {
        if (revealed.current.has(element) || observed.has(element)) return;
        // A grid item can itself be a panel. Reveal it once, without stacking entrances.
        if (!element.matches('.progress-fill, .sparkline-line, .circular-flow-step, .geo-pin-dot') && element.parentElement?.closest('.stagger-grid > *, .data-row')) return;
        observed.add(element);
        observer.observe(element);
      });
    };
    scan();
    const mutations = new MutationObserver(() => { if (!frame) frame = requestAnimationFrame(scan); });
    mutations.observe(container, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      mutations.disconnect();
      animations.forEach(animation => animation.cancel());
    };
  }, [active, reduced]);

  return <PageActivity.Provider value={active}><div ref={root} className={active ? 'workspace-page' : 'workspace-page hidden'} aria-hidden={!active}>{children}</div></PageActivity.Provider>;
}

/** Animate changed content without remounting controls or losing keyboard focus. */
export function useContentTransition<T extends HTMLElement = HTMLDivElement>(key: string | number) {
  const ref = useRef<T>(null);
  const reduced = useReducedMotion();
  const active = usePageActivity();
  useEffect(() => {
    if (!active || reduced || !ref.current) return;
    const animation = ref.current.animate([{ opacity: 0.5 }, { opacity: 1 }], { duration: motionTiming.feedback, easing: 'ease-out' });
    return () => animation.cancel();
  }, [key, reduced, active]);
  return ref;
}
