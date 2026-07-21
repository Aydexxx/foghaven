/**
 * A tiny in-memory fixed-window rate limiter for the login endpoint — the one
 * place brute forcing is worth the effort. Keyed by whatever the caller passes
 * (login uses `ip + identifier`, so one attacker IP and one targeted account
 * each have their own budget). Single-process and in-RAM, which is all a single
 * game server needs; a multi-instance deployment would swap this for a shared
 * store (Redis), which is why it's isolated behind one small class.
 *
 * Fixed window rather than sliding: simpler, and the small over-allowance at a
 * window boundary is irrelevant against a login form.
 */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  /**
   * Record an attempt for `key` and report whether it is allowed. The Nth
   * attempt within a window is the last allowed one; further attempts are
   * blocked until the window rolls over.
   */
  check(key: string, now = Date.now()): { allowed: boolean; retryAfterMs: number } {
    const entry = this.hits.get(key);
    if (!entry || now >= entry.resetAt) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      return { allowed: true, retryAfterMs: 0 };
    }
    if (entry.count >= this.max) {
      return { allowed: false, retryAfterMs: entry.resetAt - now };
    }
    entry.count += 1;
    return { allowed: true, retryAfterMs: 0 };
  }

  /** Clear a key's budget — e.g. a successful login shouldn't count against the next. */
  reset(key: string): void {
    this.hits.delete(key);
  }

  /** Drop everything (test isolation). */
  clear(): void {
    this.hits.clear();
  }
}
