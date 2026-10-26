declare module "@/shared/events/types" {
  interface DomainEventMap {
    "project.created": { projectId: string };
    /** A project entered the "completed" status (for career XP in M6). */
    "project.completed": {
      projectId: string;
      priority: number;
      areaId: string | null;
      completedAt: Date;
    };
    /** A completed project left that status. */
    "project.reopened": { projectId: string };
    "milestone.completed": { milestoneId: string; projectId: string; completedAt: Date };
  }
}

export {};
