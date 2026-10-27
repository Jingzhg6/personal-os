declare module "@/shared/events/types" {
  interface DomainEventMap {
    "project.created": { projectId: string };
    /** A project entered the "completed" status (for career XP in M6). */
    "project.completed": {
      projectId: string;
      name: string;
      priority: number;
      areaId: string | null;
      completedAt: Date;
    };
    /** A completed project left that status. */
    "project.reopened": { projectId: string };
    "milestone.completed": {
      milestoneId: string;
      projectId: string;
      name: string;
      /** Area of the milestone's project. */
      areaId: string | null;
      completedAt: Date;
    };
    /** A completed milestone was marked as not completed again. */
    "milestone.reopened": { milestoneId: string; projectId: string };
  }
}

export {};
