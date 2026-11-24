/**
 * Simple in-memory rate limiter (sliding window over timestamps).
 * Plenty for one instance with ~10–50 users; replace with Redis for multiple instances.
 */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  private sweepAt = 0;

  /** true if allowed (and counts the attempt), otherwise false. */
  take(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
    this.sweep(now);
    const arr = (this.hits.get(key) ?? []).filter((t) => t > now - windowMs);
    if (arr.length >= limit) {
      this.hits.set(key, arr);
      return false;
    }
    arr.push(now);
    this.hits.set(key, arr);
    return true;
  }

  /** Seconds until another attempt is possible. */
  retryAfter(key: string, limit: number, windowMs: number, now = Date.now()): number {
    const arr = (this.hits.get(key) ?? []).filter((t) => t > now - windowMs);
    if (arr.length < limit) return 0;
    return Math.max(1, Math.ceil((arr[0]! + windowMs - now) / 1000));
  }

  reset(key: string) {
    this.hits.delete(key);
  }

  private sweep(now: number) {
    if (now < this.sweepAt) return;
    this.sweepAt = now + 60_000;
    for (const [k, arr] of this.hits) {
      const fresh = arr.filter((t) => t > now - 3_600_000);
      if (fresh.length) this.hits.set(k, fresh);
      else this.hits.delete(k);
    }
  }
}
