import { describe, it, expect, vi } from "vitest";
import { EventBus } from "../telemetry/EventBus";

type TestEvents = { TEST: string; OTHER: number };

describe("EventBus", () => {
  it("subscribe and receive events", () => {
    const bus = new EventBus<TestEvents>();
    const handler = vi.fn();

    bus.on("TEST", handler);
    bus.emit("TEST", "hello");

    expect(handler).toHaveBeenCalledWith("hello");
  });

  it("unsubscribe stops receiving", () => {
    const bus = new EventBus<TestEvents>();
    const handler = vi.fn();

    const unsub = bus.on("TEST", handler);
    unsub();
    bus.emit("TEST", "hello");

    expect(handler).not.toHaveBeenCalled();
  });

  it("multiple listeners for same event all fire", () => {
    const bus = new EventBus<TestEvents>();
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    bus.on("TEST", handler1);
    bus.on("TEST", handler2);
    bus.emit("TEST", "data");

    expect(handler1).toHaveBeenCalledWith("data");
    expect(handler2).toHaveBeenCalledWith("data");
  });

  it("listener errors are swallowed", () => {
    const bus = new EventBus<TestEvents>();
    const badHandler = vi.fn(() => {
      throw new Error("boom");
    });
    const goodHandler = vi.fn();

    bus.on("TEST", badHandler);
    bus.on("TEST", goodHandler);

    expect(() => bus.emit("TEST", "data")).not.toThrow();
    expect(goodHandler).toHaveBeenCalledWith("data");
  });

  it("snapshot safety: adding listener during emit does NOT fire the new listener", () => {
    const bus = new EventBus<TestEvents>();
    const lateHandler = vi.fn();

    bus.on("TEST", () => {
      bus.on("TEST", lateHandler);
    });

    bus.emit("TEST", "data");

    expect(lateHandler).not.toHaveBeenCalled();
  });

  it("removeAllListeners() clears everything", () => {
    const bus = new EventBus<TestEvents>();
    const h1 = vi.fn();
    const h2 = vi.fn();

    bus.on("TEST", h1);
    bus.on("OTHER", h2);
    bus.removeAllListeners();

    bus.emit("TEST", "a");
    bus.emit("OTHER", 1);

    expect(h1).not.toHaveBeenCalled();
    expect(h2).not.toHaveBeenCalled();
  });

  it("removeAllListeners(event) clears specific event only", () => {
    const bus = new EventBus<TestEvents>();
    const testHandler = vi.fn();
    const otherHandler = vi.fn();

    bus.on("TEST", testHandler);
    bus.on("OTHER", otherHandler);
    bus.removeAllListeners("TEST");

    bus.emit("TEST", "a");
    bus.emit("OTHER", 42);

    expect(testHandler).not.toHaveBeenCalled();
    expect(otherHandler).toHaveBeenCalledWith(42);
  });

  it("listenerCount() returns correct count", () => {
    const bus = new EventBus<TestEvents>();

    expect(bus.listenerCount("TEST")).toBe(0);

    bus.on("TEST", () => {});
    bus.on("TEST", () => {});
    expect(bus.listenerCount("TEST")).toBe(2);

    bus.on("OTHER", () => {});
    expect(bus.listenerCount("OTHER")).toBe(1);
  });
});
