import {
  Gift,
  Activity,
  Bell,
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
  Landmark,
  LayoutDashboard,
  ListTodo,
  type LucideIcon,
  Milestone,
  PiggyBank,
  Settings,
  Shield,
  Sparkles,
  Sprout,
  Target,
  Trash2,
  TrendingUp,
  Wallet,
  Workflow,
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
  | "development"
  | "finance"
  | "automation"
  | "tasks"
  | "projects"
  | "goals"
  | "learning"
  | "fitness"
  | "documents"
  | "calendar"
  | "character"
  | "rewards"
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

// Default order (V3): overview, tasks (projects and every task view), work and affairs, personal
// growth and life, finance, records, system. Users may reorder groups and pages (navLayout).
export const navigation: NavSection[] = [
  {
    id: "overview",
    items: [
      {
        id: "dashboard",
        href: "/",
        icon: LayoutDashboard,
        module: "dashboard",
        phase: 1,
        milestone: "M7",
      },
      { id: "personalStats", href: "/analytics", icon: ChartColumn, module: "analytics", phase: 3 },
      {
        id: "productivity",
        href: "/analytics/productivity",
        icon: Gauge,
        module: "analytics",
        phase: 3,
      },
    ],
  },
  {
    id: "tasks",
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
      {
        id: "gantt",
        href: "/projects/gantt",
        icon: ChartGantt,
        module: "projects",
        phase: 1,
        milestone: "M5",
      },
      {
        id: "schedule",
        href: "/schedule",
        icon: CalendarClock,
        module: "calendar",
        phase: 1,
        milestone: "M11",
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
        id: "deadlines",
        href: "/admin/deadlines",
        icon: AlarmClock,
        module: "tasks",
        phase: 1,
        milestone: "M2",
      },
      {
        id: "trash",
        href: "/tasks/trash",
        icon: Trash2,
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
      {
        id: "adminTasks",
        href: "/admin",
        icon: ClipboardList,
        module: "tasks",
        phase: 1,
        milestone: "M2",
      },
      {
        id: "goals",
        href: "/projects/goals",
        icon: Target,
        module: "development",
        phase: 1,
        milestone: "M8",
      },
    ],
  },
  {
    id: "life",
    items: [
      {
        id: "development",
        href: "/development",
        icon: Sprout,
        module: "development",
        phase: 1,
        milestone: "M8",
      },
      { id: "learning", href: "/life/learning", icon: GraduationCap, module: "learning", phase: 2 },
      { id: "fitness", href: "/life/fitness", icon: Dumbbell, module: "fitness", phase: 3 },
      { id: "skills", href: "/character/skills", icon: Sparkles, module: "skills", phase: 2 },
      {
        id: "personal",
        href: "/life/personal",
        icon: Heart,
        module: "tasks",
        phase: 1,
        milestone: "M2",
      },
      { id: "calendar", href: "/calendar", icon: CalendarDays, module: "calendar", phase: 2 },
      {
        id: "character",
        href: "/character",
        icon: Shield,
        module: "character",
        phase: 1,
        milestone: "M6",
      },
      {
        id: "xp",
        href: "/character/xp",
        icon: Zap,
        module: "character",
        phase: 1,
        milestone: "M6",
      },
      {
        id: "rewards",
        href: "/rewards",
        icon: Gift,
        module: "rewards",
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
  {
    id: "finance",
    items: [
      {
        id: "financeOverview",
        href: "/finance",
        icon: Wallet,
        module: "finance",
        phase: 1,
        milestone: "M9",
      },
      {
        id: "financeAccounts",
        href: "/finance/accounts",
        icon: Landmark,
        module: "finance",
        phase: 1,
        milestone: "M9",
      },
      {
        id: "financeInvestments",
        href: "/finance/investments",
        icon: PiggyBank,
        module: "finance",
        phase: 1,
        milestone: "M11",
      },
    ],
  },
  {
    id: "records",
    items: [
      { id: "documents", href: "/admin/documents", icon: FileText, module: "documents", phase: 2 },
    ],
  },
  {
    id: "system",
    items: [
      {
        id: "automationRules",
        href: "/automation",
        icon: Workflow,
        module: "automation",
        phase: 1,
        milestone: "M10",
      },
      {
        id: "automationNotifications",
        href: "/automation/notifications",
        icon: Bell,
        module: "automation",
        phase: 1,
        milestone: "M10",
      },
      { id: "settings", href: "/settings", icon: Settings, module: "settings", phase: 1 },
    ],
  },
];

export const allNavItems: NavItem[] = navigation.flatMap((section) => section.items);

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

export interface NavLayout {
  sections: string[];
  items: Record<string, string[]>;
}

/**
 * The navigation in a user's saved order: groups first, then pages within each group. Unknown
 * ids are ignored and anything added since keeps its default place at the end, so a saved layout
 * never hides a page. Pages never move between groups.
 */
export function applyNavLayout(layout: NavLayout | null | undefined): NavSection[] {
  if (!layout) return navigation;
  const byId = new Map(navigation.map((s) => [s.id as string, s]));
  const sectionIds = [
    ...layout.sections.filter((id, i, all) => byId.has(id) && all.indexOf(id) === i),
    ...navigation.map((s) => s.id as string).filter((id) => !layout.sections.includes(id)),
  ];
  return sectionIds.map((id) => {
    const section = byId.get(id)!;
    const saved = layout.items[id] ?? [];
    const itemById = new Map(section.items.map((item) => [item.id as string, item]));
    const kept = saved.filter(
      (itemId, i, all) => itemById.has(itemId) && all.indexOf(itemId) === i,
    );
    return {
      ...section,
      items: [
        ...kept.map((itemId) => itemById.get(itemId)!),
        ...section.items.filter((item) => !kept.includes(item.id)),
      ],
    };
  });
}

/** The layout of a navigation, for saving. */
export function layoutOf(sections: readonly NavSection[]): NavLayout {
  return {
    sections: sections.map((s) => s.id),
    items: Object.fromEntries(sections.map((s) => [s.id, s.items.map((i) => i.id)])),
  };
}
