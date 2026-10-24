import {
  Activity,
  AlarmClock,
  Briefcase,
  CalendarClock,
  CalendarDays,
  ChartColumn,
  ChartGantt,
  ChartLine,
  ClipboardList,
  Columns3,
  Dumbbell,
  FileText,
  FolderKanban,
  Gauge,
  GraduationCap,
  Grid2x2,
  Heart,
  LayoutDashboard,
  ListTodo,
  type LucideIcon,
  Milestone,
  Settings,
  Shield,
  Sparkles,
  Target,
  TrendingUp,
  Zap,
} from "lucide-react";

import type { Messages } from "@/shared/i18n/messages";

/*
 * Three separate concepts (see docs/architecture.md, "Areas, modules and navigation"):
 *
 *  - Module:      a functional capability that owns data and logic (tasks, projects, …).
 *  - Navigation:  what the user sees in the sidebar. A section groups items; an item opens a
 *                 view, which is rendered by a module. Several items can be rendered by the
 *                 same module (e.g. "Work" and "Admin tasks" are both views of `tasks`).
 *  - Area:        user-defined data (categories on tasks/projects). Navigation items may later
 *                 be *scoped* to areas, but navigation is never generated from area rows.
 */

export type ModuleId =
  | "dashboard"
  | "tasks"
  | "projects"
  | "goals"
  | "learning"
  | "fitness"
  | "documents"
  | "calendar"
  | "character"
  | "skills"
  | "analytics"
  | "settings";

export type NavSectionId = keyof Messages["nav"]["sections"];
export type NavItemId = keyof Messages["nav"]["items"];

export interface NavItem {
  id: NavItemId;
  href: string;
  icon: LucideIcon;
  /** The module that renders this view. */
  module: ModuleId;
  /** Delivery phase from the roadmap. */
  phase: 1 | 2 | 3;
  /** Phase 1 milestone that delivers the view, when known. */
  milestone?: `M${number}`;
}

export interface NavSection {
  id: NavSectionId;
  items: NavItem[];
}

export const navigation: NavSection[] = [
  {
    id: "overview",
    items: [
      {
        id: "dashboard",
        href: "/dashboard",
        icon: LayoutDashboard,
        module: "dashboard",
        phase: 1,
        milestone: "M7",
      },
    ],
  },
  {
    id: "tasks",
    items: [
      {
        id: "allTasks",
        href: "/tasks",
        icon: ListTodo,
        module: "tasks",
        phase: 1,
        milestone: "M1",
      },
      {
        id: "matrix",
        href: "/tasks/matrix",
        icon: Grid2x2,
        module: "tasks",
        phase: 1,
        milestone: "M3",
      },
    ],
  },
  {
    id: "projects",
    items: [
      {
        id: "allProjects",
        href: "/projects",
        icon: FolderKanban,
        module: "projects",
        phase: 1,
        milestone: "M4",
      },
      {
        id: "kanban",
        href: "/projects/kanban",
        icon: Columns3,
        module: "projects",
        phase: 1,
        milestone: "M4",
      },
      {
        id: "gantt",
        href: "/projects/gantt",
        icon: ChartGantt,
        module: "projects",
        phase: 1,
        milestone: "M5",
      },
      { id: "goals", href: "/projects/goals", icon: Target, module: "goals", phase: 2 },
    ],
  },
  {
    id: "life",
    items: [
      { id: "learning", href: "/life/learning", icon: GraduationCap, module: "learning", phase: 2 },
      { id: "fitness", href: "/life/fitness", icon: Dumbbell, module: "fitness", phase: 3 },
      {
        id: "personal",
        href: "/life/personal",
        icon: Heart,
        module: "tasks",
        phase: 1,
        milestone: "M2",
      },
    ],
  },
  {
    id: "work",
    items: [
      { id: "work", href: "/work", icon: Briefcase, module: "tasks", phase: 1, milestone: "M2" },
      {
        id: "business",
        href: "/work/business",
        icon: TrendingUp,
        module: "tasks",
        phase: 1,
        milestone: "M2",
      },
    ],
  },
  {
    id: "administration",
    items: [
      {
        id: "adminTasks",
        href: "/admin",
        icon: ClipboardList,
        module: "tasks",
        phase: 1,
        milestone: "M2",
      },
      { id: "documents", href: "/admin/documents", icon: FileText, module: "documents", phase: 2 },
      {
        id: "deadlines",
        href: "/admin/deadlines",
        icon: AlarmClock,
        module: "tasks",
        phase: 1,
        milestone: "M2",
      },
    ],
  },
  {
    id: "calendar",
    items: [
      { id: "calendar", href: "/calendar", icon: CalendarDays, module: "calendar", phase: 2 },
      {
        id: "scheduled",
        href: "/calendar/scheduled",
        icon: CalendarClock,
        module: "calendar",
        phase: 2,
      },
    ],
  },
  {
    id: "character",
    items: [
      {
        id: "character",
        href: "/character",
        icon: Shield,
        module: "character",
        phase: 1,
        milestone: "M6",
      },
      { id: "skills", href: "/character/skills", icon: Sparkles, module: "skills", phase: 2 },
      {
        id: "xp",
        href: "/character/xp",
        icon: Zap,
        module: "character",
        phase: 1,
        milestone: "M6",
      },
      {
        id: "progression",
        href: "/character/progression",
        icon: Milestone,
        module: "character",
        phase: 2,
      },
    ],
  },
  {
    id: "analytics",
    items: [
      { id: "personalStats", href: "/analytics", icon: ChartColumn, module: "analytics", phase: 3 },
      {
        id: "productivity",
        href: "/analytics/productivity",
        icon: Gauge,
        module: "analytics",
        phase: 3,
      },
      {
        id: "learningStats",
        href: "/analytics/learning",
        icon: ChartLine,
        module: "analytics",
        phase: 3,
      },
      {
        id: "fitnessStats",
        href: "/analytics/fitness",
        icon: Activity,
        module: "analytics",
        phase: 3,
      },
    ],
  },
];

/** Items outside the sections, pinned to the bottom of the sidebar. */
export const settingsNavItem: NavItem = {
  id: "settings",
  href: "/settings",
  icon: Settings,
  module: "settings",
  phase: 1,
};

export const allNavItems: NavItem[] = [
  ...navigation.flatMap((section) => section.items),
  settingsNavItem,
];

export function findNavItem(pathname: string): NavItem | null {
  return allNavItems.find((item) => item.href === pathname) ?? null;
}

export function findNavSection(item: NavItem): NavSection | null {
  return navigation.find((section) => section.items.includes(item)) ?? null;
}

/** Longest href that prefixes the pathname, so nested pages keep their parent highlighted. */
export function findActiveNavItem(pathname: string): NavItem | null {
  let best: NavItem | null = null;
  for (const item of allNavItems) {
    const matches = pathname === item.href || pathname.startsWith(`${item.href}/`);
    if (matches && (!best || item.href.length > best.href.length)) best = item;
  }
  return best;
}
