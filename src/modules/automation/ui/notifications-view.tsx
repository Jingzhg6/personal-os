"use client";

import { Bell, Check } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { Card, CardContent } from "@/shared/ui/card";
import { PageHeader } from "@/shared/ui/page-header";

import { useDateTime } from "./summary";
import { useAutomationActions, useNotifications } from "./use-automation";

/** Minimal in-app notifications created by the `notify` action (no push, e-mail or SMS). */
export function NotificationsView({ title }: { title: string }) {
  const t = useTranslations("automation.notifications");
  const dateTime = useDateTime();
  const { data } = useNotifications();
  const { markRead } = useAutomationActions();

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6" data-testid="automation-notifications">
      <PageHeader
        title={title}
        description={t("description")}
        actions={
          data && data.unread > 0 ? (
            <Button
              variant="secondary"
              onClick={() => markRead.mutate({ id: null })}
              data-testid="notifications-read-all"
            >
              <Check aria-hidden />
              {t("markAllRead")}
            </Button>
          ) : null
        }
      />
      {data ? (
        <p className="text-sm text-muted-foreground" data-testid="notifications-unread">
          {t("unread", { count: data.unread })}
        </p>
      ) : null}
      {data && data.items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-sm text-muted-foreground">
            <Bell className="size-6" aria-hidden />
            {t("empty")}
          </CardContent>
        </Card>
      ) : null}
      {data && data.items.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {data.items.map((n) => (
            <li key={n.id}>
              <Card
                className={cn(n.readAt === null && "border-primary/40 bg-primary/5")}
                data-testid="notification"
                data-read={n.readAt !== null}
              >
                <CardContent className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="font-medium">{n.title}</span>
                    {n.body ? (
                      <span className="text-sm text-muted-foreground">{n.body}</span>
                    ) : null}
                    <span className="text-xs text-muted-foreground">
                      {dateTime(n.createdAt)}
                      {n.ruleId ? (
                        <>
                          {" · "}
                          <Link href={`/automation/${n.ruleId}`} className="hover:underline">
                            {t("fromRule")}
                          </Link>
                        </>
                      ) : null}
                    </span>
                  </div>
                  {n.readAt === null ? (
                    <Button size="sm" variant="ghost" onClick={() => markRead.mutate({ id: n.id })}>
                      {t("markRead")}
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">{t("read")}</span>
                  )}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
