"use client";

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Check, ChevronDown, GripVertical, Hexagon, ListOrdered, RotateCcw } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useState, type ReactNode } from "react";

import { cn } from "@/shared/lib/cn";

import {
  applyNavLayout,
  findActiveNavItem,
  findNavSection,
  layoutOf,
  navigation,
  type NavItem,
  type NavLayout,
  type NavSection,
  type NavSectionId,
} from "./navigation";
import { UserMenu, type ShellUser } from "./user-menu";

const COLLAPSED_KEY = "personal-os.sidebar.collapsed";

function readCollapsed(): Set<NavSectionId> {
  try {
    const stored = JSON.parse(window.localStorage.getItem(COLLAPSED_KEY) ?? "[]") as unknown;
    const known = new Set<string>(navigation.map((s) => s.id));
    return new Set(
      Array.isArray(stored)
        ? (stored.filter((id) => typeof id === "string" && known.has(id)) as NavSectionId[])
        : [],
    );
  } catch {
    return new Set();
  }
}

/**
 * Which sections are collapsed, remembered per browser. Everything starts open (also before the
 * stored choice is read, so server and client render the same); the section of the current page
 * is reopened whenever the user navigates into it.
 */
function useCollapsedSections(activeSection: NavSectionId | undefined) {
  const [collapsed, setCollapsed] = useState<Set<NavSectionId>>(() => new Set());

  useEffect(() => {
    const stored = readCollapsed();
    if (activeSection) stored.delete(activeSection);
    // Reading browser storage after hydration is the point of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCollapsed(stored);
  }, [activeSection]);

  const toggle = useCallback((id: NavSectionId) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
      } catch {
        // Storage unavailable (private mode): the choice lasts for this page only.
      }
      return next;
    });
  }, []);

  return { collapsed, toggle };
}

/** "s" + section for groups, "i:<section>" for pages: only like targets are considered. */
const dragScope = (id: unknown) => {
  const [kind, section] = String(id).split(":");
  return kind === "s" ? "s" : `i:${section}`;
};
const sameScope: CollisionDetection = (args) =>
  closestCenter({
    ...args,
    droppableContainers: args.droppableContainers.filter(
      (c) => dragScope(c.id) === dragScope(args.active.id),
    ),
  });

interface SidebarProps {
  user: ShellUser;
  /** Called when a link is clicked (closes the mobile drawer). */
  onNavigate?: () => void;
  /** The user's saved group and page order (null = default). */
  layout?: NavLayout | null;
  /** Saves a new order (null = back to the default). Without it the order cannot be changed. */
  onLayoutChange?: (layout: NavLayout | null) => void;
}

export function Sidebar({ user, onNavigate, layout = null, onLayoutChange }: SidebarProps) {
  const t = useTranslations();
  const pathname = usePathname();
  const active = findActiveNavItem(pathname);
  const activeSection = active ? findNavSection(active)?.id : undefined;
  const { collapsed, toggle } = useCollapsedSections(activeSection);
  const [editing, setEditing] = useState(false);
  const sections = applyNavLayout(layout);
  const dndId = useId();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  /** Ids are "s:<section>" for groups and "i:<section>:<item>" for pages (pages stay in their group). */
  function onDragEnd({ active: from, over }: DragEndEvent) {
    if (!over || from.id === over.id || !onLayoutChange) return;
    const [kind, section, item] = String(from.id).split(":");
    const [overKind, overSection, overItem] = String(over.id).split(":");
    let next: NavSection[] | null = null;
    if (kind === "s" && overKind === "s") {
      const ids = sections.map((s) => s.id as string);
      next = arrayMove(sections, ids.indexOf(section!), ids.indexOf(overSection!));
    } else if (kind === "i" && overKind === "i" && section === overSection) {
      next = sections.map((s) => {
        if (s.id !== section) return s;
        const ids = s.items.map((i) => i.id as string);
        return { ...s, items: arrayMove(s.items, ids.indexOf(item!), ids.indexOf(overItem!)) };
      });
    }
    if (next) onLayoutChange(layoutOf(next));
  }

  return (
    <div className="flex h-full w-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex h-14 shrink-0 items-center gap-2.5 px-5">
        <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground shadow-sm">
          <Hexagon className="size-4" strokeWidth={2.5} />
        </span>
        <span className="text-[15px] font-semibold tracking-tight text-foreground">
          {t("common.appName")}
        </span>
      </div>

      <nav aria-label={t("nav.mainNavigation")} className="flex-1 overflow-y-auto px-3 pt-2 pb-4">
        <DndContext
          id={dndId}
          sensors={sensors}
          collisionDetection={sameScope}
          onDragEnd={onDragEnd}
          accessibility={{ screenReaderInstructions: { draggable: t("nav.dragInstructions") } }}
        >
          <SortableContext
            items={sections.map((s) => `s:${s.id}`)}
            strategy={verticalListSortingStrategy}
          >
            {sections.map((section) => {
              const open = editing || !collapsed.has(section.id);
              const label = t(`nav.sections.${section.id}`);
              const listId = `nav-section-${section.id}`;
              return (
                <SortableRow
                  key={section.id}
                  id={`s:${section.id}`}
                  enabled={editing}
                  handleLabel={t("nav.dragSection", { section: label })}
                  className="mb-3"
                  data={{ "data-testid": "nav-section", "data-section": section.id }}
                  header={
                    <h2 className="min-w-0 flex-1 text-xs font-medium text-muted-foreground">
                      <button
                        type="button"
                        onClick={() => toggle(section.id)}
                        disabled={editing}
                        aria-expanded={open}
                        aria-controls={listId}
                        title={
                          open
                            ? t("nav.collapseSection", { section: label })
                            : t("nav.expandSection", { section: label })
                        }
                        className="flex w-full items-center gap-1 rounded-md px-2 py-1 text-left transition-colors hover:bg-surface-muted hover:text-foreground disabled:hover:bg-transparent"
                      >
                        <span className="flex-1 truncate">{label}</span>
                        {editing ? null : (
                          <ChevronDown
                            aria-hidden
                            className={cn(
                              "size-3.5 shrink-0 transition-transform",
                              !open && "-rotate-90",
                            )}
                          />
                        )}
                      </button>
                    </h2>
                  }
                >
                  <SortableContext
                    items={section.items.map((item) => `i:${section.id}:${item.id}`)}
                    strategy={verticalListSortingStrategy}
                  >
                    <ul id={listId} hidden={!open} className="space-y-0.5 pt-0.5">
                      {section.items.map((item) => (
                        <SortableRow
                          key={item.id}
                          as="li"
                          id={`i:${section.id}:${item.id}`}
                          enabled={editing}
                          handleLabel={t("nav.dragItem", { item: t(`nav.items.${item.id}`) })}
                          data={{ "data-item": item.id }}
                          header={
                            <SidebarLink
                              item={item}
                              active={item === active}
                              onNavigate={onNavigate}
                              inert={editing}
                            />
                          }
                        />
                      ))}
                    </ul>
                  </SortableContext>
                </SortableRow>
              );
            })}
          </SortableContext>
        </DndContext>
        {onLayoutChange ? (
          <div className="mt-1 flex flex-wrap gap-1 px-1">
            <button
              type="button"
              onClick={() => setEditing((v) => !v)}
              aria-pressed={editing}
              data-testid="nav-customize"
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-surface-muted hover:text-foreground",
                editing && "bg-primary/10 text-primary",
              )}
            >
              {editing ? (
                <Check className="size-3.5" aria-hidden />
              ) : (
                <ListOrdered className="size-3.5" aria-hidden />
              )}
              {editing ? t("nav.customizeDone") : t("nav.customize")}
            </button>
            {editing && layout ? (
              <button
                type="button"
                onClick={() => onLayoutChange(null)}
                data-testid="nav-reset"
                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-surface-muted hover:text-foreground"
              >
                <RotateCcw className="size-3.5" aria-hidden />
                {t("nav.resetLayout")}
              </button>
            ) : null}
          </div>
        ) : null}
      </nav>

      <div className="shrink-0 border-t border-border p-3">
        <UserMenu user={user} />
      </div>
    </div>
  );
}

/** A group or page row; while reordering it gets a drag handle (the row itself never drags). */
function SortableRow({
  id,
  enabled,
  handleLabel,
  header,
  children,
  className,
  data,
  as: Tag = "div",
}: {
  id: string;
  enabled: boolean;
  handleLabel: string;
  header: ReactNode;
  children?: ReactNode;
  className?: string;
  data?: Record<string, string>;
  as?: "div" | "li";
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled: !enabled });
  return (
    <Tag
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        className,
        isDragging && "relative z-10 rounded-md bg-surface opacity-90 shadow-md",
      )}
      {...data}
    >
      <div className="flex items-center gap-0.5">
        {enabled ? (
          <button
            type="button"
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            aria-label={handleLabel}
            data-testid="nav-drag-handle"
            className="flex size-6 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted-foreground hover:bg-surface-muted hover:text-foreground active:cursor-grabbing"
          >
            <GripVertical className="size-3.5" aria-hidden />
          </button>
        ) : null}
        <div className="min-w-0 flex-1">{header}</div>
      </div>
      {children}
    </Tag>
  );
}

function SidebarLink({
  item,
  active,
  onNavigate,
  inert = false,
}: {
  item: NavItem;
  active: boolean;
  onNavigate?: () => void;
  /** While reordering, pages are plain rows: no link, so a drag can never navigate. */
  inert?: boolean;
}) {
  const t = useTranslations();
  const Icon = item.icon;
  const className = cn(
    "group flex h-8 items-center gap-2.5 rounded-md px-2 text-sm transition-colors",
    active
      ? "bg-sidebar-active font-medium text-sidebar-active-foreground"
      : "hover:bg-surface-muted hover:text-foreground",
  );
  if (inert) {
    return (
      <span className={className}>
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate">{t(`nav.items.${item.id}`)}</span>
      </span>
    );
  }

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={className}
    >
      <Icon
        className={cn(
          "size-4 shrink-0",
          active ? "text-primary" : "text-muted-foreground group-hover:text-foreground",
        )}
      />
      <span className="truncate">{t(`nav.items.${item.id}`)}</span>
      {item.phase > 1 ? (
        <span className="ml-auto rounded px-1 text-[10px] font-medium text-muted-foreground/70 tabular-nums">
          {t("common.phaseShort", { phase: item.phase })}
        </span>
      ) : null}
    </Link>
  );
}
