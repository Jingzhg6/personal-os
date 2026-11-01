"use client";

import { ChevronDown, Hexagon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";

import { cn } from "@/shared/lib/cn";

import {
  findActiveNavItem,
  findNavSection,
  navigation,
  type NavItem,
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

interface SidebarProps {
  user: ShellUser;
  /** Called when a link is clicked (closes the mobile drawer). */
  onNavigate?: () => void;
}

export function Sidebar({ user, onNavigate }: SidebarProps) {
  const t = useTranslations();
  const pathname = usePathname();
  const active = findActiveNavItem(pathname);
  const activeSection = active ? findNavSection(active)?.id : undefined;
  const { collapsed, toggle } = useCollapsedSections(activeSection);

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
        {navigation.map((section) => {
          const open = !collapsed.has(section.id);
          const label = t(`nav.sections.${section.id}`);
          const listId = `nav-section-${section.id}`;
          return (
            <div
              key={section.id}
              className="mb-3"
              data-testid="nav-section"
              data-section={section.id}
            >
              <h2 className="text-xs font-medium text-muted-foreground">
                <button
                  type="button"
                  onClick={() => toggle(section.id)}
                  aria-expanded={open}
                  aria-controls={listId}
                  title={
                    open
                      ? t("nav.collapseSection", { section: label })
                      : t("nav.expandSection", { section: label })
                  }
                  className="flex w-full items-center gap-1 rounded-md px-2 py-1 text-left transition-colors hover:bg-surface-muted hover:text-foreground"
                >
                  <span className="flex-1 truncate">{label}</span>
                  <ChevronDown
                    aria-hidden
                    className={cn("size-3.5 shrink-0 transition-transform", !open && "-rotate-90")}
                  />
                </button>
              </h2>
              <ul id={listId} hidden={!open} className="space-y-0.5 pt-0.5">
                {section.items.map((item) => (
                  <li key={item.id}>
                    <SidebarLink item={item} active={item === active} onNavigate={onNavigate} />
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </nav>

      <div className="shrink-0 border-t border-border p-3">
        <UserMenu user={user} />
      </div>
    </div>
  );
}

function SidebarLink({
  item,
  active,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  onNavigate?: () => void;
}) {
  const t = useTranslations();
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex h-8 items-center gap-2.5 rounded-md px-2 text-sm transition-colors",
        active
          ? "bg-sidebar-active font-medium text-sidebar-active-foreground"
          : "hover:bg-surface-muted hover:text-foreground",
      )}
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
