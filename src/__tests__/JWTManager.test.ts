import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JWTManager } from '../client/JWTManager';
import { createMockTelemetry, createMockLogger, createMockJWTProvider, createTestJWT } from './helpers';

describe('JWTManager', () => {
  let telemetry: ReturnType<typeof createMockTelemetry>;
  let logger: ReturnType<typeof createMockLogger>;
  let provider: ReturnType<typeof createMockJWTProvider>;

  beforeEach(() => {
    telemetry = createMockTelemetry();
    logger = createMockLogger();
    provider = createMockJWTProvider();
  });

  function createManager(opts?: { flowOverrides?: any; circuitBreaker?: any }) {
    return new JWTManager(provider, telemetry, logger, opts?.flowOverrides, opts?.circuitBreaker);
  }

  it('returns cached token when valid and not expiring soon', async () => {
    const jwt = createTestJWT(Math.floor(Date.now() / 1000) + 300);
    (provider.getJWT as ReturnType<typeof vi.fn>).mockResolvedValue(jwt);

    const manager = createManager();
    const first = await manager.getToken('CRYPTO_BUY');
    const second = await manager.getToken('CRYPTO_BUY');

    expect(first).toBe(jwt);
    expect(second).toBe(jwt);
    expect(provider.getJWT).toHaveBeenCalledTimes(1);
  });

  it('refreshes when token is expiring soon (within 30s)', async () => {
    const expiringSoon = createTestJWT(Math.floor(Date.now() / 1000) + 10);
    const freshToken = createTestJWT(Math.floor(Date.now() / 1000) + 300);
    (provider.getJWT as ReturnType<typeof vi.fn>).mockResolvedValueOnce(expiringSoon).mockResolvedValueOnce(freshToken);

    const manager = createManager();
    await manager.getToken('CRYPTO_BUY');
    const second = await manager.getToken('CRYPTO_BUY');

    expect(provider.getJWT).toHaveBeenCalledTimes(2);
    expect(second).toBe(freshToken);
  });

  it('emits JWT_EXPIRED telemetry when cached token is fully expired', async () => {
    const expired = createTestJWT(Math.floor(Date.now() / 1000) - 60);
    const fresh = createTestJWT(Math.floor(Date.now() / 1000) + 300);
    (provider.getJWT as ReturnType<typeof vi.fn>).mockResolvedValueOnce(expired).mockResolvedValueOnce(fresh);

    const manager = createManager();
    await manager.getToken('CRYPTO_BUY');
    await manager.getToken('CRYPTO_BUY');

    expect(telemetry.track).toHaveBeenCalledWith('JWT_EXPIRED', 'CRYPTO_BUY', expect.any(Object));
  });

  it('deduplicates concurrent fetches for same flow', async () => {
    const jwt = createTestJWT(Math.floor(Date.now() / 1000) + 300);
    (provider.getJWT as ReturnType<typeof vi.fn>).mockResolvedValue(jwt);

    const manager = createManager();
    const [a, b] = await Promise.all([manager.getToken('CRYPTO_BUY'), manager.getToken('CRYPTO_BUY')]);

    expect(a).toBe(jwt);
    expect(b).toBe(jwt);
    expect(provider.getJWT).toHaveBeenCalledTimes(1);
  });

  it('uses per-flow jwtProvider when configured in flowOverrides', async () => {
    const globalJwt = createTestJWT(Math.floor(Date.now() / 1000) + 300);
    const flowJwt = createTestJWT(Math.floor(Date.now() / 1000) + 300);
    const flowProvider = createMockJWTProvider();

    (provider.getJWT as ReturnType<typeof vi.fn>).mockResolvedValue(globalJwt);
    (flowProvider.getJWT as ReturnType<typeof vi.fn>).mockResolvedValue(flowJwt);

    const manager = createManager({
      flowOverrides: { CRYPTO_BUY: { jwtProvider: flowProvider } },
    });

    const token = await manager.getToken('CRYPTO_BUY');
    expect(token).toBe(flowJwt);
    expect(flowProvider.getJWT).toHaveBeenCalledTimes(1);
    expect(provider.getJWT).not.toHaveBeenCalled();
  });

  it('falls back to global provider when no per-flow override', async () => {
    const jwt = createTestJWT(Math.floor(Date.now() / 1000) + 300);
    (provider.getJWT as ReturnType<typeof vi.fn>).mockResolvedValue(jwt);

    const manager = createManager({
      flowOverrides: { CRYPTO_SELL: { jwtProvider: createMockJWTProvider() } },
    });

    const token = await manager.getToken('CRYPTO_BUY');
    expect(token).toBe(jwt);
    expect(provider.getJWT).toHaveBeenCalledTimes(1);
  });

  it('throws ZeroHashError with JWT_FETCH_FAILED on provider error', async () => {
    (provider.getJWT as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network error'));

    const manager = createManager();

    await expect(manager.getToken('CRYPTO_BUY')).rejects.toMatchObject({
      code: 'JWT_FETCH_FAILED',
    });
  });

  it('invalidate() clears single flow cache', async () => {
    const jwt = createTestJWT(Math.floor(Date.now() / 1000) + 300);
    (provider.getJWT as ReturnType<typeof vi.fn>).mockResolvedValue(jwt);

    const manager = createManager();
    await manager.getToken('CRYPTO_BUY');
    manager.invalidate('CRYPTO_BUY');
    await manager.getToken('CRYPTO_BUY');

    expect(provider.getJWT).toHaveBeenCalledTimes(2);
  });

  it('invalidateAll() clears all cached tokens', async () => {
    const jwt = createTestJWT(Math.floor(Date.now() / 1000) + 300);
    (provider.getJWT as ReturnType<typeof vi.fn>).mockResolvedValue(jwt);

    const manager = createManager();
    await manager.getToken('CRYPTO_BUY');
    await manager.getToken('CRYPTO_SELL');
    manager.invalidateAll();
    await manager.getToken('CRYPTO_BUY');
    await manager.getToken('CRYPTO_SELL');

    expect(provider.getJWT).toHaveBeenCalledTimes(4);
  });

  it('getCacheStatus() returns correct flows', async () => {
    const jwt = createTestJWT(Math.floor(Date.now() / 1000) + 300);
    (provider.getJWT as ReturnType<typeof vi.fn>).mockResolvedValue(jwt);

    const manager = createManager();
    await manager.getToken('CRYPTO_BUY');
    await manager.getToken('CRYPTO_SELL');

    const status = manager.getCacheStatus();
    expect(status.cachedFlows).toContain('CRYPTO_BUY');
    expect(status.cachedFlows).toContain('CRYPTO_SELL');
    expect(status.inflightFlows).toHaveLength(0);
  });
});
