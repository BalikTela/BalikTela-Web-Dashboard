import type { Express } from 'express';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';

type Diagnostic = Record<string, string | number>;
type Logger = (message: string, details: Diagnostic) => void;

export function installRuntimeMonitoring(app: Express, options: {
  slowRequestMs?: number; eventLoopWarningMs?: number; intervalMs?: number; log?: Logger;
} = {}) {
  const log = options.log ?? ((message, details) => console.warn(message, details));
  const slowRequestMs = options.slowRequestMs ?? 2_000;
  app.use('/api', (req, res, next) => {
    const start = performance.now();
    res.once('finish', () => {
      const durationMs = performance.now() - start;
      if (durationMs < slowRequestMs) return;
      const route = typeof req.route?.path === 'string' && /^\/[a-zA-Z0-9_:/.-]{0,199}$/.test(req.route.path) ? req.route.path : 'unmatched';
      log('Slow API request.', { route, method: req.method, status: res.statusCode, durationMs: Math.round(durationMs) });
    });
    next();
  });
  const delay = monitorEventLoopDelay({ resolution: 20 });
  delay.enable();
  let previous = performance.eventLoopUtilization();
  const timer = setInterval(() => {
    const eventLoop = performance.eventLoopUtilization(previous);
    previous = performance.eventLoopUtilization();
    const maxDelayMs = delay.max / 1_000_000;
    if (maxDelayMs >= (options.eventLoopWarningMs ?? 500)) {
      const memory = process.memoryUsage();
      log('Event loop delayed.', { maxDelayMs: Math.round(maxDelayMs),
        p99DelayMs: Math.round(delay.percentile(99) / 1_000_000),
        eventLoopBusyPercent: Math.round(eventLoop.utilization * 100),
        rssMb: Math.round(memory.rss / 1_048_576), heapUsedMb: Math.round(memory.heapUsed / 1_048_576) });
    }
    delay.reset();
  }, options.intervalMs ?? 30_000);
  timer.unref();
  return () => { clearInterval(timer); delay.disable(); };
}
