"use client";

import { Hexagon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

import { cn } from "@/shared/lib/cn";

import { findActiveNavItem, navigation, type NavItem, settingsNavItem } from "./navigation";
import { UserMenu, type ShellUser } from "./user-menu";

interface SidebarProps {
  user: ShellUser;
  /** Called when a link is clicked (closes the mobile drawer). */
  onNavigate?: () => void;
}

export function Sidebar({ user, onNavigate }: SidebarProps) {
  const t = useTranslations();
  const pathname = usePathname();
  const active = findActiveNavItem(pathname);

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
        {navigation.map((section) => (
          <div key={section.id} className="mb-4">
            <h2 className="px-2 pb-1 text-xs font-medium text-muted-foreground">
              {t(`nav.sections.${section.id}`)}
            </h2>
            <ul className="space-y-0.5">
              {section.items.map((item) => (
                <li key={item.id}>
                  <SidebarLink item={item} active={item === active} onNavigate={onNavigate} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="shrink-0 border-t border-border p-3">
        <SidebarLink
          item={settingsNavItem}
          active={settingsNavItem === active}
          onNavigate={onNavigate}
        />
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
