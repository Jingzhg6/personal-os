declare module "@/shared/events/types" {
  interface DomainEventMap {
    /** A development goal moved to another status (M10: consumed by automation rules). */
    "goal.status_changed": {
      goalId: string;
      title: string;
      fromStatus: string;
      toStatus: string;
    };
  }
}

export {};
