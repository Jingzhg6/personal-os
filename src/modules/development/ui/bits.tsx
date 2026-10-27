"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import type { DevelopmentAttribute } from "@/modules/character/domain";
import { useAttributeLabel } from "@/modules/character/ui";
import { cn } from "@/shared/lib/cn";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { ColorDot } from "@/shared/ui/color";

/** An attribute's identity: colour, emoji and name (optionally linking to its page). */
export function AttributeName({
  attribute,
  href,
  className,
}: {
  attribute: Pick<DevelopmentAttribute, "id" | "color" | "icon" | "name" | "systemKey">;
  href?: string;
  className?: string;
}) {
  const label = useAttributeLabel();
  const content = (
    <>
      <ColorDot color={attribute.color} />
      {attribute.icon ? <span aria-hidden>{attribute.icon}</span> : null}
      <span className="truncate">{label(attribute)}</span>
    </>
  );
  const classes = cn("inline-flex min-w-0 items-center gap-1.5", className);
  return href ? (
    <Link href={href} className={cn(classes, "hover:underline")}>
      {content}
    </Link>
  ) : (
    <span className={classes}>{content}</span>
  );
}

export const attributeHref = (id: string) => `/development/attributes/${id}`;
export const goalHref = (id: string) => `/development/goals/${id}`;

/** A titled card in the M7 style (icon in the primary colour, optional action on the right). */
export function SectionCard({
  icon,
  title,
  action,
  children,
  className,
  testId,
}: {
  icon: ReactNode;
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <Card className={cn("flex flex-col", className)} data-testid={testId}>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2">
          <span className="text-primary">{icon}</span>
          {title}
        </CardTitle>
        {action}
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">{children}</CardContent>
    </Card>
  );
}

/** A friendly empty state: what is missing and what to do about it. */
export function EmptyState({
  title,
  hint,
  action,
  testId,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
  testId?: string;
}) {
  return (
    <div
      className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border px-4 py-6 text-center"
      data-testid={testId}
    >
      <p className="text-sm font-medium">{title}</p>
      {hint ? <p className="max-w-sm text-xs text-muted-foreground">{hint}</p> : null}
      {action}
    </div>
  );
}
