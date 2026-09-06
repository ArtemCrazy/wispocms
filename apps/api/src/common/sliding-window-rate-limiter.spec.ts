import { SlidingWindowRateLimiter } from './sliding-window-rate-limiter';

describe('SlidingWindowRateLimiter', () => {
  it('blocks attempts after the configured limit', () => {
    const limiter = new SlidingWindowRateLimiter(1_000, 2);

    expect(limiter.tryConsume('client', 100)).toBe(true);
    expect(limiter.tryConsume('client', 200)).toBe(true);
    expect(limiter.tryConsume('client', 300)).toBe(false);
  });

  it('allows attempts after the window expires', () => {
    const limiter = new SlidingWindowRateLimiter(1_000, 1);

    expect(limiter.tryConsume('client', 100)).toBe(true);
    expect(limiter.tryConsume('client', 500)).toBe(false);
    expect(limiter.tryConsume('client', 1_101)).toBe(true);
  });

  it('clears failures after a successful action', () => {
    const limiter = new SlidingWindowRateLimiter(1_000, 1);

    limiter.record('client', 100);
    limiter.clear('client');

    expect(limiter.isBlocked('client', 200)).toBe(false);
  });

  it('evicts the least recently used keys to bound memory', () => {
    const limiter = new SlidingWindowRateLimiter(10_000, 1, 2);

    limiter.record('one', 100);
    limiter.record('two', 200);
    limiter.record('three', 300);

    expect(limiter.trackedKeys()).toBe(2);
    expect(limiter.isBlocked('one', 400)).toBe(false);
  });
});
