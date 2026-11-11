/**
 * Fixed-window in-memory rate limiter. Good enough for a single instance;
 * when running several instances behind a load balancer each one counts separately.
 */
interface Window {
  start: number;
  count: number;
}

export class RateLimiter {
  private windows = new Map<string, Window>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number = 60_000,
  ) {}

  /** Returns 0 when allowed, otherwise the number of seconds to wait. */
  hit(key: string, now: number = Date.now()): number {
    const current = this.windows.get(key);
    if (!current || now - current.start >= this.windowMs) {
      this.windows.set(key, { start: now, count: 1 });
      this.sweep(now);
      return 0;
    }
    current.count += 1;
    if (current.count > this.limit) {
      return Math.max(1, Math.ceil((current.start + this.windowMs - now) / 1000));
    }
    return 0;
  }

  reset(): void {
    this.windows.clear();
  }

  private sweep(now: number): void {
    if (this.windows.size < 10_000) return;
    for (const [key, window] of this.windows) {
      if (now - window.start >= this.windowMs) this.windows.delete(key);
    }
  }
}
