import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CircuitBreaker } from '../utils/CircuitBreaker';
import { ErrorCode } from '../errors/ErrorCodes';
import { createMockTelemetry, createMockLogger } from './helpers';

describe('CircuitBreaker', () => {
  let telemetry: ReturnType<typeof createMockTelemetry>;
  let logger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    telemetry = createMockTelemetry();
    logger = createMockLogger();
  });

  function createBreaker(config?: { failureThreshold?: number; resetTimeoutMs?: number; halfOpenMaxAttempts?: number }) {
    return new CircuitBreaker(config, telemetry, logger);
  }

  it('starts in CLOSED state', () => {
    const breaker = createBreaker();
    expect(breaker.getState().state).toBe('CLOSED');
  });

  it('stays CLOSED after successful calls', async () => {
    const breaker = createBreaker({ failureThreshold: 3 });
    await breaker.execute(() => Promise.resolve('ok'));
    await breaker.execute(() => Promise.resolve('ok'));
    expect(breaker.getState().state).toBe('CLOSED');
  });

  it('transitions to OPEN after failureThreshold failures', async () => {
    const breaker = createBreaker({ failureThreshold: 3 });
    const fail = () => Promise.reject(new Error('fail'));

    for (let i = 0; i < 3; i++) {
      await breaker.execute(fail).catch(() => {});
    }

    expect(breaker.getState().state).toBe('OPEN');
  });

  it('rejects immediately when OPEN with CIRCUIT_OPEN error', async () => {
    const breaker = createBreaker({ failureThreshold: 3 });
    const fail = () => Promise.reject(new Error('fail'));

    for (let i = 0; i < 3; i++) {
      await breaker.execute(fail).catch(() => {});
    }

    try {
      await breaker.execute(() => Promise.resolve('ok'));
      expect.unreachable('should have thrown');
    } catch (err: any) {
      expect(err.code).toBe(ErrorCode.CIRCUIT_OPEN);
    }
  });

  it('transitions to HALF_OPEN after resetTimeoutMs and allows a test request', async () => {
    vi.useFakeTimers();
    const breaker = createBreaker({ failureThreshold: 3, resetTimeoutMs: 5000 });
    const fail = () => Promise.reject(new Error('fail'));

    for (let i = 0; i < 3; i++) {
      await breaker.execute(fail).catch(() => {});
    }
    expect(breaker.getState().state).toBe('OPEN');

    vi.advanceTimersByTime(5000);

    // The transition to HALF_OPEN happens when execute is called after the timeout
    await breaker.execute(() => Promise.resolve('ok'));
    // After success in HALF_OPEN, it transitions to CLOSED
    expect(breaker.getState().state).toBe('CLOSED');

    vi.useRealTimers();
  });

  it('transitions to CLOSED on HALF_OPEN success', async () => {
    vi.useFakeTimers();
    const breaker = createBreaker({ failureThreshold: 3, resetTimeoutMs: 5000 });
    const fail = () => Promise.reject(new Error('fail'));

    for (let i = 0; i < 3; i++) {
      await breaker.execute(fail).catch(() => {});
    }

    vi.advanceTimersByTime(5000);

    await breaker.execute(() => Promise.resolve('ok'));
    expect(breaker.getState().state).toBe('CLOSED');

    vi.useRealTimers();
  });

  it('transitions back to OPEN on HALF_OPEN failure', async () => {
    vi.useFakeTimers();
    const breaker = createBreaker({ failureThreshold: 3, resetTimeoutMs: 5000 });
    const fail = () => Promise.reject(new Error('fail'));

    for (let i = 0; i < 3; i++) {
      await breaker.execute(fail).catch(() => {});
    }

    vi.advanceTimersByTime(5000);

    await breaker.execute(fail).catch(() => {});
    expect(breaker.getState().state).toBe('OPEN');

    vi.useRealTimers();
  });

  it('emits CIRCUIT_OPENED, CIRCUIT_HALF_OPEN, and CIRCUIT_CLOSED telemetry', async () => {
    vi.useFakeTimers();
    const breaker = createBreaker({ failureThreshold: 3, resetTimeoutMs: 5000 });
    const fail = () => Promise.reject(new Error('fail'));

    for (let i = 0; i < 3; i++) {
      await breaker.execute(fail).catch(() => {});
    }
    expect(telemetry.track).toHaveBeenCalledWith('CIRCUIT_OPENED', undefined, expect.any(Object));

    vi.advanceTimersByTime(5000);
    // Trigger half-open by attempting execute
    await breaker.execute(() => Promise.resolve('ok'));
    expect(telemetry.track).toHaveBeenCalledWith('CIRCUIT_HALF_OPEN', undefined, expect.any(Object));
    expect(telemetry.track).toHaveBeenCalledWith('CIRCUIT_CLOSED', undefined, expect.any(Object));

    vi.useRealTimers();
  });

  it('reset() returns to CLOSED with 0 failures', async () => {
    const breaker = createBreaker({ failureThreshold: 3 });
    const fail = () => Promise.reject(new Error('fail'));

    for (let i = 0; i < 2; i++) {
      await breaker.execute(fail).catch(() => {});
    }

    breaker.reset();
    expect(breaker.getState().state).toBe('CLOSED');

    // Should need full threshold again to open
    await breaker.execute(fail).catch(() => {});
    await breaker.execute(fail).catch(() => {});
    expect(breaker.getState().state).toBe('CLOSED');
  });
});
