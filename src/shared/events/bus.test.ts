import { describe, expect, it, vi } from "vitest";

import type { DbExecutor } from "../db/types";
import { createEventBus, EventHandlerError } from "./bus";

declare module "./types" {
  interface DomainEventMap {
    "test.happened": { value: number };
    "test.other": { label: string };
  }
}

const ctx = { db: {} as DbExecutor };

describe("event bus", () => {
  it("delivers a typed event to subscribers in registration order", async () => {
    const bus = createEventBus();
    const calls: string[] = [];
    bus.subscribe("test.happened", (e) => void calls.push(`a:${e.payload.value}`), { name: "a" });
    bus.subscribe("test.happened", (e) => void calls.push(`b:${e.payload.value}`), { name: "b" });

    const event = await bus.publish(
      { type: "test.happened", userId: "u1", payload: { value: 7 } },
      ctx,
    );

    expect(calls).toEqual(["a:7", "b:7"]);
    expect(event).toMatchObject({ type: "test.happened", userId: "u1", payload: { value: 7 } });
    expect(event.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(event.occurredAt).toBeInstanceOf(Date);
  });

  it("awaits async handlers sequentially", async () => {
    const bus = createEventBus();
    const calls: string[] = [];
    bus.subscribe(
      "test.happened",
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        calls.push("slow");
      },
      { name: "slow" },
    );
    bus.subscribe("test.happened", () => void calls.push("fast"), { name: "fast" });

    await bus.publish({ type: "test.happened", userId: "u1", payload: { value: 1 } }, ctx);
    expect(calls).toEqual(["slow", "fast"]);
  });

  it("passes the publisher's db executor so handlers can join its transaction", async () => {
    const bus = createEventBus();
    const handler = vi.fn();
    bus.subscribe("test.happened", handler, { name: "h" });
    await bus.publish({ type: "test.happened", userId: "u1", payload: { value: 1 } }, ctx);
    expect(handler.mock.calls[0]![1].db).toBe(ctx.db);
  });

  it("only delivers events of the subscribed type", async () => {
    const bus = createEventBus();
    const handler = vi.fn();
    bus.subscribe("test.other", handler, { name: "h" });
    await bus.publish({ type: "test.happened", userId: "u1", payload: { value: 1 } }, ctx);
    expect(handler).not.toHaveBeenCalled();
  });

  it("rejects with EventHandlerError and stops when a handler fails", async () => {
    const bus = createEventBus();
    const after = vi.fn();
    bus.subscribe(
      "test.happened",
      () => {
        throw new Error("boom");
      },
      { name: "broken" },
    );
    bus.subscribe("test.happened", after, { name: "after" });

    const publishing = bus.publish(
      { type: "test.happened", userId: "u1", payload: { value: 1 } },
      ctx,
    );
    await expect(publishing).rejects.toBeInstanceOf(EventHandlerError);
    await expect(publishing).rejects.toMatchObject({
      handlerName: "broken",
      eventType: "test.happened",
    });
    expect(after).not.toHaveBeenCalled();
  });

  it("supports unsubscribing and rejects duplicate handler names", async () => {
    const bus = createEventBus();
    const handler = vi.fn();
    const unsubscribe = bus.subscribe("test.happened", handler, { name: "h" });
    expect(() => bus.subscribe("test.happened", vi.fn(), { name: "h" })).toThrow(
      /already subscribed/,
    );

    unsubscribe();
    await bus.publish({ type: "test.happened", userId: "u1", payload: { value: 1 } }, ctx);
    expect(handler).not.toHaveBeenCalled();
  });
});
