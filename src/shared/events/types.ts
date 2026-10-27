import type { DbExecutor } from "../db/types";

/**
 * Registry of every domain event in the system, keyed by a stable event type.
 *
 * Modules declare their own events by augmenting this interface, e.g.
 *
 *   declare module "@/shared/events/types" {
 *     interface DomainEventMap {
 *       "task.completed": { taskId: string };
 *     }
 *   }
 *
 * The publisher and the subscribers are then type-checked against the payload.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface DomainEventMap {}

export type DomainEventType = keyof DomainEventMap;

export interface DomainEvent<T extends DomainEventType = DomainEventType> {
  id: string;
  type: T;
  /** Owner of the data the event is about. Every event is user-scoped. */
  userId: string;
  occurredAt: Date;
  payload: DomainEventMap[T];
}

export interface EventContext {
  /**
   * The executor the event was published with. When the publisher is inside a
   * transaction, handlers join it, so side effects (e.g. XP awards) commit or
   * roll back together with the change that caused them.
   */
  db: DbExecutor;
  /**
   * Set when the change was made by an automation (M10): how deep in an automation chain it is
   * and which rules already acted. Absent for a person's own actions.
   */
  origin?: EventOrigin;
}

export interface EventOrigin {
  depth: number;
  ruleIds: string[];
}

export type EventHandler<T extends DomainEventType> = (
  event: DomainEvent<T>,
  ctx: EventContext,
) => void | Promise<void>;

export interface PublishInput<T extends DomainEventType> {
  type: T;
  userId: string;
  payload: DomainEventMap[T];
}
