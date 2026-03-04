import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConversionTracker } from '../client/ConversionTracker';
import { createMockTelemetry, createMockLogger } from './helpers';

describe('ConversionTracker', () => {
  let telemetry: ReturnType<typeof createMockTelemetry>;
  let logger: ReturnType<typeof createMockLogger>;
  let hooks: {
    onStepCompleted: ReturnType<typeof vi.fn>;
    onFunnelCompleted: ReturnType<typeof vi.fn>;
    onFunnelAbandoned: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    telemetry = createMockTelemetry();
    logger = createMockLogger();
    hooks = {
      onStepCompleted: vi.fn(),
      onFunnelCompleted: vi.fn(),
      onFunnelAbandoned: vi.fn(),
    };
  });

  function createTracker(overrides?: Partial<typeof hooks>) {
    return new ConversionTracker({ ...hooks, ...overrides }, telemetry, logger);
  }

  it('beginFunnel starts tracking with FLOW_INITIATED step', () => {
    const tracker = createTracker();
    tracker.beginFunnel('CRYPTO_BUY');

    const funnel = tracker.getActiveFunnel('CRYPTO_BUY');
    expect(funnel).toBeDefined();
    expect(funnel!.steps).toEqual(
      expect.arrayContaining([expect.objectContaining({ step: 'FLOW_INITIATED' })]),
    );
  });

  it('recordStep adds steps with correct timestamps and durationMs', async () => {
    const tracker = createTracker();
    tracker.beginFunnel('CRYPTO_BUY');
    tracker.recordStep('CRYPTO_BUY', 'USER_INTERACTED');

    const funnel = tracker.getActiveFunnel('CRYPTO_BUY');
    const step = funnel!.steps.find((s) => s.step === 'USER_INTERACTED');
    expect(step).toBeDefined();
    expect(step!.timestamp).toEqual(expect.any(Number));
    expect(step!.durationMs).toEqual(expect.any(Number));
  });

  it('completeFunnel records FLOW_COMPLETED and calls onFunnelCompleted hook', () => {
    const tracker = createTracker();
    tracker.beginFunnel('CRYPTO_BUY');
    tracker.completeFunnel('CRYPTO_BUY');

    expect(hooks.onFunnelCompleted).toHaveBeenCalledTimes(1);
    expect(hooks.onFunnelCompleted).toHaveBeenCalledWith(
      'CRYPTO_BUY',
      expect.any(Number),
    );
  });

  it('abandonFunnel records FLOW_ABANDONED and calls onFunnelAbandoned hook', () => {
    const tracker = createTracker();
    tracker.beginFunnel('CRYPTO_BUY');
    tracker.abandonFunnel('CRYPTO_BUY');

    expect(hooks.onFunnelAbandoned).toHaveBeenCalledTimes(1);
    expect(hooks.onFunnelAbandoned).toHaveBeenCalledWith(
      'CRYPTO_BUY',
      expect.any(String),
      expect.any(Number),
    );
  });

  it('overwriting existing funnel auto-abandons the previous one', () => {
    const tracker = createTracker();
    tracker.beginFunnel('CRYPTO_BUY');
    tracker.beginFunnel('CRYPTO_BUY');

    expect(hooks.onFunnelAbandoned).toHaveBeenCalledTimes(1);
  });

  it('onStepCompleted hook is called for each step', () => {
    const tracker = createTracker();
    tracker.beginFunnel('CRYPTO_BUY');
    tracker.recordStep('CRYPTO_BUY', 'USER_INTERACTED');
    tracker.recordStep('CRYPTO_BUY', 'TRANSACTION_SUBMITTED');

    // onStepCompleted called for FLOW_INITIATED + USER_INTERACTED + TRANSACTION_SUBMITTED
    expect(hooks.onStepCompleted).toHaveBeenCalledTimes(3);
  });

  it('hook errors are swallowed and do not crash the tracker', () => {
    const tracker = createTracker({
      onStepCompleted: vi.fn((): void => { throw new Error('hook boom'); }) as unknown as ReturnType<typeof vi.fn>,
    });

    expect(() => {
      tracker.beginFunnel('CRYPTO_BUY');
      tracker.recordStep('CRYPTO_BUY', 'USER_INTERACTED');
    }).not.toThrow();
  });

  it('getActiveFunnel returns funnel data', () => {
    const tracker = createTracker();
    tracker.beginFunnel('CRYPTO_BUY');

    const funnel = tracker.getActiveFunnel('CRYPTO_BUY');
    expect(funnel).toBeDefined();
    expect(funnel!.flow).toBe('CRYPTO_BUY');
  });

  it('getActiveFunnels returns summaries of all active funnels', () => {
    const tracker = createTracker();
    tracker.beginFunnel('CRYPTO_BUY');
    tracker.beginFunnel('CRYPTO_SELL');

    const funnels = tracker.getActiveFunnels();
    expect(funnels).toHaveLength(2);
    expect(funnels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ flow: 'CRYPTO_BUY' }),
        expect.objectContaining({ flow: 'CRYPTO_SELL' }),
      ]),
    );
  });

  it('reset() clears all funnels', () => {
    const tracker = createTracker();
    tracker.beginFunnel('CRYPTO_BUY');
    tracker.beginFunnel('CRYPTO_SELL');
    tracker.reset();

    expect(tracker.getActiveFunnels()).toHaveLength(0);
    expect(tracker.getActiveFunnel('CRYPTO_BUY')).toBeUndefined();
  });
});
