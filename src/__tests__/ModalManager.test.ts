import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ModalManager } from '../client/ModalManager';
import { ErrorCode } from '../errors/ErrorCodes';
import { createMockTelemetry, createMockLogger, createMockSDK } from './helpers';

describe('ModalManager', () => {
  let telemetry: ReturnType<typeof createMockTelemetry>;
  let logger: ReturnType<typeof createMockLogger>;
  let sdk: ReturnType<typeof createMockSDK>;

  beforeEach(() => {
    telemetry = createMockTelemetry();
    logger = createMockLogger();
    sdk = createMockSDK();
  });

  function createManager() {
    return new ModalManager(sdk, telemetry, logger);
  }

  it('opens modal and sets active flow', async () => {
    const manager = createManager();
    await manager.open('CRYPTO_BUY', 'jwt-token');

    expect(manager.currentFlow).toBe('CRYPTO_BUY');
    expect(manager.isOpen).toBe(true);
    expect(sdk.openModal).toHaveBeenCalled();
  });

  it('emits FLOW_OPENED telemetry on successful open', async () => {
    const manager = createManager();
    await manager.open('CRYPTO_BUY', 'jwt-token');

    expect(telemetry.track).toHaveBeenCalledWith('FLOW_OPENED', 'CRYPTO_BUY');
  });

  it('rejects concurrent opens (opening guard)', async () => {
    const manager = createManager();
    (sdk.openModal as ReturnType<typeof vi.fn>).mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 100)));

    const first = manager.open('CRYPTO_BUY', 'jwt-token');
    const second = manager.open('CRYPTO_SELL', 'jwt-token');

    await expect(second).rejects.toMatchObject({ code: ErrorCode.MODAL_CONFLICT });
    await first;
  });

  it('rejects when another flow is already active', async () => {
    const manager = createManager();
    await manager.open('CRYPTO_BUY', 'jwt-token');

    (sdk.isModalOpen as ReturnType<typeof vi.fn>).mockReturnValue(true);

    await expect(manager.open('CRYPTO_SELL', 'jwt-token')).rejects.toMatchObject({
      code: ErrorCode.MODAL_CONFLICT,
    });
  });

  it('reconciles stale state when activeFlow set but sdk says modal closed', async () => {
    const manager = createManager();
    await manager.open('CRYPTO_BUY', 'jwt-token');

    // SDK says modal is not open (stale state)
    (sdk.isModalOpen as ReturnType<typeof vi.fn>).mockReturnValue(false);

    // Should reconcile and allow a new open
    await manager.open('CRYPTO_SELL', 'jwt-token');
    expect(manager.currentFlow).toBe('CRYPTO_SELL');
  });

  it('closes modal and clears active flow', async () => {
    const manager = createManager();
    await manager.open('CRYPTO_BUY', 'jwt-token');
    await manager.close('CRYPTO_BUY');

    expect(manager.currentFlow).toBeNull();
    expect(manager.isOpen).toBe(false);
  });

  it('emits FLOW_CLOSED on close', async () => {
    const manager = createManager();
    await manager.open('CRYPTO_BUY', 'jwt-token');
    await manager.close('CRYPTO_BUY');

    expect(telemetry.track).toHaveBeenCalledWith('FLOW_CLOSED', 'CRYPTO_BUY');
  });

  it('throws FLOW_NOT_ACTIVE when closing wrong flow', async () => {
    const manager = createManager();
    await manager.open('CRYPTO_BUY', 'jwt-token');

    (sdk.isModalOpen as ReturnType<typeof vi.fn>).mockReturnValue(true);

    await expect(manager.close('CRYPTO_SELL')).rejects.toMatchObject({
      code: ErrorCode.FLOW_NOT_ACTIVE,
    });
  });

  it('reconciles on close when SDK says modal already closed', async () => {
    const manager = createManager();
    await manager.open('CRYPTO_BUY', 'jwt-token');

    (sdk.isModalOpen as ReturnType<typeof vi.fn>).mockReturnValue(false);
    await manager.close('CRYPTO_BUY');

    expect(manager.currentFlow).toBeNull();
    expect(manager.isOpen).toBe(false);
  });

  it('forceReset() clears all state', async () => {
    const manager = createManager();
    await manager.open('CRYPTO_BUY', 'jwt-token');

    manager.forceReset();

    expect(manager.currentFlow).toBeNull();
    expect(manager.isOpen).toBe(false);
  });
});
