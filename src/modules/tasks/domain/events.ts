declare module "@/shared/events/types" {
  interface DomainEventMap {
    "task.created": { taskId: string; parentTaskId: string | null };
    /** A task entered the "completed" category. */
    "task.completed": {
      taskId: string;
      areaId: string | null;
      priority: number;
      isUrgent: boolean | null;
      isImportant: boolean | null;
      estimatedMinutes: number | null;
      completedAt: Date;
    };
    /** A completed task left the "completed" category (reopened or cancelled). */
    "task.reopened": { taskId: string };
  }
}

export {};
