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
    /** A task (and its subtasks, listed in taskIds) moved to the Trash. */
    "task.deleted": { taskId: string; taskIds: string[] };
    /** Tasks restored from the Trash. */
    "task.restored": { taskId: string; taskIds: string[] };
  }
}

export {};
