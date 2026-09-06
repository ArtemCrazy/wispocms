export class SlidingWindowRateLimiter {
  private readonly attempts = new Map<string, number[]>();

  constructor(
    private readonly windowMs: number,
    private readonly maxAttempts: number,
    private readonly maxKeys = 5000,
  ) {}

  isBlocked(key: string, now = Date.now()) {
    return this.recentAttempts(key, now).length >= this.maxAttempts;
  }

  record(key: string, now = Date.now()) {
    const attempts = this.recentAttempts(key, now);
    attempts.push(now);
    this.touch(key, attempts);
  }

  tryConsume(key: string, now = Date.now()) {
    if (this.isBlocked(key, now)) return false;
    this.record(key, now);
    return true;
  }

  clear(key: string) {
    this.attempts.delete(key);
  }

  trackedKeys() {
    return this.attempts.size;
  }

  private recentAttempts(key: string, now: number) {
    const since = now - this.windowMs;
    const attempts = (this.attempts.get(key) ?? []).filter(
      (timestamp) => timestamp > since,
    );
    if (attempts.length) this.touch(key, attempts);
    else this.attempts.delete(key);
    return attempts;
  }

  private touch(key: string, attempts: number[]) {
    this.attempts.delete(key);
    this.attempts.set(key, attempts);
    while (this.attempts.size > this.maxKeys) {
      const oldestKey = this.attempts.keys().next().value as string | undefined;
      if (!oldestKey) break;
      this.attempts.delete(oldestKey);
    }
  }
}
