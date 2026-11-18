"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";

import { useTRPC } from "@/shared/trpc/react";
import { Button } from "@/shared/ui/button";
import { useToast } from "@/shared/ui/toast";
import { useErrorMessage } from "@/shared/ui/use-error-message";

import type { NavLayout } from "./navigation";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import type { ShellUser } from "./user-menu";

export function AppShell({
  user,
  navLayout = null,
  children,
}: {
  user: ShellUser;
  /** The user's saved sidebar order, read on the server with the other settings. */
  navLayout?: NavLayout | null;
  children: ReactNode;
}) {
  const t = useTranslations("shell");
  const tn = useTranslations("nav");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [layout, setLayout] = useState<NavLayout | null>(navLayout);
  const trpc = useTRPC();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const save = useMutation(trpc.settings.update.mutationOptions());
  const changeLayout = (next: NavLayout | null) => {
    const previous = layout;
    setLayout(next);
    save.mutate(
      { navLayout: next },
      {
        onSuccess: () => toast.show(next ? tn("layoutSaved") : tn("layoutReset")),
        onError: (error) => {
          setLayout(previous);
          toast.show(errorMessage(error), "error");
        },
      },
    );
  };

  useEffect(() => {
    if (!drawerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [drawerOpen]);

  return (
    <div className="flex min-h-dvh">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-surface px-3 py-2 text-sm shadow-md focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        {t("skipToContent")}
      </a>

      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 border-r border-border lg:flex">
        <Sidebar user={user} layout={layout} onLayoutChange={changeLayout} />
      </aside>

      {drawerOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
            onClick={() => setDrawerOpen(false)}
            aria-hidden
          />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] border-r border-border shadow-md">
            <Sidebar
              user={user}
              layout={layout}
              onLayoutChange={changeLayout}
              onNavigate={() => setDrawerOpen(false)}
            />
            <Button
              variant="ghost"
              size="icon-sm"
              className="absolute top-3 right-3"
              onClick={() => setDrawerOpen(false)}
              aria-label={t("closeNavigation")}
            >
              <X />
            </Button>
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onOpenNavigation={() => setDrawerOpen(true)} />
        <main id="main" className="flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
