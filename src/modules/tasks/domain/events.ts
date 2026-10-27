declare module "@/shared/events/types" {
  interface DomainEventMap {
    "task.created": { taskId: string; parentTaskId: string | null };
    /** A task entered the "completed" category. */
    "task.completed": {
      taskId: string;
      /** Title when completed (the XP history shows what was done at the time). */
      title: string;
      parentTaskId: string | null;
      /** Development attributes the task grows, with weights (independent of its area). */
      contributions: { attributeId: string; weight: number }[];
      areaId: string | null;
      priority: number;
      isUrgent: boolean | null;
      isImportant: boolean | null;
      estimatedMinutes: number | null;
      completedAt: Date;
    };
    /** A task moved to another status (any category; published besides completed / reopened). */
    "task.status_changed": {
      taskId: string;
      fromStatusId: string;
      toStatusId: string;
      toCategory: string;
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
