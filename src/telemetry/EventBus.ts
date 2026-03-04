export type EventHandler<T = unknown> = (payload: T) => void;

export type EventBusErrorHandler = (event: string, error: unknown) => void;

export class EventBus<TEventMap extends Record<string, unknown>> {
  private readonly listeners = new Map<
    keyof TEventMap,
    Set<EventHandler<never>>
  >();
  private readonly onError: EventBusErrorHandler;

  constructor(onError?: EventBusErrorHandler) {
    this.onError = onError ?? ((event) => {
      console.error(`[EventBus] Listener error for event "${event}"`);
    });
  }

  on<K extends keyof TEventMap>(
    event: K,
    handler: EventHandler<TEventMap[K]>
  ): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }

    const handlers = this.listeners.get(event)!;
    handlers.add(handler as EventHandler<never>);

    // Return unsubscribe function
    return () => {
      handlers.delete(handler as EventHandler<never>);
      if (handlers.size === 0) {
        this.listeners.delete(event);
      }
    };
  }

  emit<K extends keyof TEventMap>(event: K, payload: TEventMap[K]): void {
    const handlers = this.listeners.get(event);
    if (!handlers) return;

    // Snapshot to avoid non-deterministic behavior if a handler adds/removes listeners
    const snapshot = Array.from(handlers);
    for (const handler of snapshot) {
      try {
        (handler as EventHandler<TEventMap[K]>)(payload);
      } catch (error: unknown) {
        // Swallow listener errors — telemetry must never crash the host
        this.onError(String(event), error);
      }
    }
  }

  removeAllListeners(event?: keyof TEventMap): void {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }

  listenerCount(event: keyof TEventMap): number {
    return this.listeners.get(event)?.size ?? 0;
  }
}
