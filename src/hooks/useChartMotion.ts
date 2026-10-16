import { useEffect, useMemo, useRef, useState } from 'react';
import type { Chart, ChartType } from 'chart.js';
import { motionTiming, usePageActivity, useReducedMotion } from '../lib/motion';

export function useChartMotion<T extends ChartType>() {
  const ref = useRef<Chart<T> | null>(null);
  const entered = useRef(false);
  const [visible, setVisible] = useState(false);
  const active = usePageActivity();
  const reduced = useReducedMotion();

  useEffect(() => {
    const chart = ref.current;
    if (!chart) return;
    const settle = () => {
      if (!chart.ctx || !chart.options) return;
      chart.stop();
      chart.options.animation = false;
      chart.update('none');
    };
    settle();
    if (reduced || !active) return;
    let intersecting = false;
    const update = () => {
      settle();
      const showing = intersecting && !document.hidden;
      if (showing && !entered.current) {
        entered.current = true;
        chart.reset();
      }
      setVisible(showing);
    };
    const observer = new IntersectionObserver(([entry]) => {
      intersecting = entry.isIntersecting;
      update();
    }, { threshold: 0.05 });
    observer.observe(chart.canvas);
    document.addEventListener('visibilitychange', update);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', update);
      settle();
    };
  }, [active, reduced]);

  const animation = useMemo(() => active && visible && !reduced
    ? { duration: motionTiming.chart, easing: 'easeOutQuart' as const } : false as const, [active, visible, reduced]);
  return { ref, animation };
}
