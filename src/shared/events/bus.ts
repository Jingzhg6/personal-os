import { newId } from "../lib/id";
import type {
  DomainEvent,
  DomainEventType,
  EventContext,
  EventHandler,
  PublishInput,
} from "./types";

export class EventHandlerError extends Error {
  constructor(
    readonly eventType: string,
    readonly handlerName: string,
    options: { cause: unknown },
  ) {
    super(`Handler "${handlerName}" failed for event "${eventType}"`, options);
    this.name = "EventHandlerError";
  }
}

interface Registration {
  name: string;
  handler: EventHandler<never>;
}

export interface SubscribeOptions {
  /** Shown in errors and logs. Convention: "<module>.<purpose>". */
  name: string;
}

export interface EventBus {
  subscribe<T extends DomainEventType>(
    type: T,
    handler: EventHandler<T>,
    options: SubscribeOptions,
  ): () => void;
  publish<T extends DomainEventType>(
    input: PublishInput<T>,
    ctx: EventContext,
  ): Promise<DomainEvent<T>>;
}

/**
 * In-process, synchronous domain event bus.
 *
 * Handlers run sequentially in registration order and are awaited. If a handler
 * throws, publish rejects with an EventHandlerError, so a publisher running in a
 * transaction rolls back everything. This is used for consistency-critical
 * reactions (e.g. XP ledger entries).
 *
 * Side effects that talk to the outside world (calendar push, AI) will go through
 * a transactional outbox + job queue in Phase 2, behind the same subscribe API.
 */
export function createEventBus(): EventBus {
  const handlers = new Map<DomainEventType, Registration[]>();

  return {
    subscribe(type, handler, { name }) {
      const list = handlers.get(type) ?? [];
      if (list.some((registration) => registration.name === name)) {
        throw new Error(`Handler "${name}" is already subscribed to "${String(type)}"`);
      }
      const registration: Registration = { name, handler: handler as EventHandler<never> };
      handlers.set(type, [...list, registration]);

      return () => {
        handlers.set(
          type,
          (handlers.get(type) ?? []).filter((entry) => entry !== registration),
        );
      };
    },

    async publish(input, ctx) {
      const event = {
        id: newId(),
        type: input.type,
        userId: input.userId,
        occurredAt: new Date(),
        payload: input.payload,
      } as DomainEvent<typeof input.type>;

      for (const { name, handler } of handlers.get(input.type) ?? []) {
        try {
          await (handler as EventHandler<typeof input.type>)(event, ctx);
        } catch (cause) {
          throw new EventHandlerError(String(input.type), name, { cause });
        }
      }

      return event;
    },
  };
}
