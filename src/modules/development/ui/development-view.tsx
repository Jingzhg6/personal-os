"use client";

import { Compass, Info, Pencil, Plus, Star, TrendingUp } from "lucide-react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useId, useMemo, useState } from "react";

import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { Dialog } from "@/shared/ui/dialog";
import { PageHeader } from "@/shared/ui/page-header";
import { useToast } from "@/shared/ui/toast";

import { RECENT_WINDOW_DAYS, type DevelopmentOverview } from "../domain";
import { AttributesSection } from "./attributes-section";
import { AttributeName, attributeHref, EmptyState, goalHref, SectionCard } from "./bits";
import { GoalFormDialog, textareaClass } from "./goal-form-dialog";
import { GoalsSection } from "./goals-section";
import { PlansOverview } from "./plans-overview";
import { useDevelopmentActions, useDevelopmentOverview } from "./use-development";

/**
 * 成长: the personal-development planning page. Vision → goals → attributes; the chosen focus is
 * shown next to (and never mixed with) what grew most recently.
 */
export function DevelopmentView({ title }: { title: string }) {
  const t = useTranslations("development");
  const router = useRouter();
  const toast = useToast();
  const { data } = useDevelopmentOverview();
  const actions = useDevelopmentActions();
  const [creating, setCreating] = useState(false);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6" data-testid="development">
      <PageHeader
        title={title}
        description={t("description")}
        actions={
          <Button onClick={() => setCreating(true)} disabled={!data}>
            <Plus />
            {t("goals.new")}
          </Button>
        }
      />
      <ConceptStrip />
      {data ? (
        <>
          <VisionCard vision={data.vision} />
          <div className="grid gap-6 md:grid-cols-2">
            <FocusCard data={data} />
            <RecentGrowthCard data={data} />
          </div>
          <GoalsSection data={data} onCreate={() => setCreating(true)} />
          <PlansOverview data={data} />
          <AttributesSection data={data} />
        </>
      ) : (
        <div className="flex flex-col gap-6" aria-hidden>
          <div className="h-32 animate-pulse rounded-lg bg-surface-muted" />
          <div className="h-48 animate-pulse rounded-lg bg-surface-muted" />
        </div>
      )}
      {creating ? (
        <GoalFormDialog
          open
          pending={actions.create.isPending}
          onClose={() => setCreating(false)}
          onSubmit={(values) =>
            actions.create.mutate(values, {
              onSuccess: (goal) => {
                setCreating(false);
                toast.show(t("form.created", { title: goal.title }));
                router.push(goalHref(goal.id));
              },
            })
          }
        />
      ) : null}
    </div>
  );
}

const conceptKeys = ["area", "attribute", "goal", "task", "xp"] as const;

/** The five concepts, kept apart in one line each. */
function ConceptStrip() {
  const t = useTranslations("development.concepts");
  return (
    <details className="group rounded-lg border border-border bg-surface px-4 py-2.5 text-sm">
      <summary className="flex cursor-pointer items-center gap-2 text-muted-foreground select-none">
        <Info className="size-4" aria-hidden />
        {t("label")}
      </summary>
      <ul className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2 lg:grid-cols-3">
        {conceptKeys.map((key) => (
          <li key={key}>{t(key)}</li>
        ))}
      </ul>
    </details>
  );
}

function VisionCard({ vision }: { vision: string | null }) {
  const t = useTranslations("development.vision");
  const tc = useTranslations("common");
  const toast = useToast();
  const actions = useDevelopmentActions();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(vision ?? "");
  const id = useId();

  const save = () =>
    actions.updateVision.mutate(
      { vision: draft.trim() || null },
      {
        onSuccess: () => {
          setEditing(false);
          toast.show(t("saved"));
        },
      },
    );

  return (
    <SectionCard
      icon={<Compass className="size-4" aria-hidden />}
      title={t("title")}
      testId="vision"
      action={
        vision && !editing ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setDraft(vision);
              setEditing(true);
            }}
          >
            <Pencil />
            {t("edit")}
          </Button>
        ) : null
      }
    >
      {editing ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <label htmlFor={id} className="text-sm text-muted-foreground">
            {t("prompt")}
          </label>
          <textarea
            id={id}
            autoFocus
            rows={4}
            maxLength={2000}
            value={draft}
            placeholder={t("placeholder")}
            onChange={(event) => setDraft(event.target.value)}
            className={textareaClass}
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setEditing(false)}>
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={actions.updateVision.isPending}>
              {t("save")}
            </Button>
          </div>
        </form>
      ) : vision ? (
        <blockquote
          className="border-l-2 border-primary/50 pl-4 text-base leading-relaxed whitespace-pre-line"
          data-testid="vision-text"
        >
          {vision}
        </blockquote>
      ) : (
        <EmptyState
          testId="vision-empty"
          title={t("empty")}
          hint={t("prompt")}
          action={
            <Button
              size="sm"
              className="mt-1"
              onClick={() => {
                setDraft("");
                setEditing(true);
              }}
            >
              {t("write")}
            </Button>
          }
        />
      )}
    </SectionCard>
  );
}

/** 我的成长重点: chosen by the user, at most `maxFocus`. */
function FocusCard({ data }: { data: DevelopmentOverview }) {
  const t = useTranslations("development.focus");
  const [choosing, setChoosing] = useState(false);
  const attributeOf = useMemo(
    () => new Map(data.attributes.map((summary) => [summary.attribute.id, summary.attribute])),
    [data.attributes],
  );
  const chosen = data.focusAttributeIds.flatMap((id) => {
    const attribute = attributeOf.get(id);
    return attribute ? [attribute] : [];
  });

  return (
    <SectionCard
      icon={<Star className="size-4" aria-hidden />}
      title={t("title")}
      testId="focus"
      action={
        chosen.length > 0 ? (
          <Button variant="ghost" size="sm" onClick={() => setChoosing(true)}>
            <Pencil />
            {t("edit")}
          </Button>
        ) : null
      }
    >
      {chosen.length === 0 ? (
        <EmptyState
          testId="focus-empty"
          title={t("empty", { max: data.maxFocus })}
          action={
            <Button
              size="sm"
              className="mt-1"
              onClick={() => setChoosing(true)}
              disabled={data.attributes.length === 0}
            >
              {t("choose")}
            </Button>
          }
        />
      ) : (
        <ol className="flex flex-col gap-2" data-testid="focus-list">
          {chosen.map((attribute, index) => (
            <li
              key={attribute.id}
              className="flex items-center gap-3 rounded-md bg-surface-muted/60 px-3 py-2.5"
            >
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/12 text-xs font-semibold text-primary tabular-nums">
                {index + 1}
              </span>
              <AttributeName
                attribute={attribute}
                href={attributeHref(attribute.id)}
                className="font-medium"
              />
            </li>
          ))}
        </ol>
      )}
      <p className="mt-auto text-xs text-muted-foreground">{t("hint", { max: data.maxFocus })}</p>
      {choosing ? <FocusDialog data={data} onClose={() => setChoosing(false)} /> : null}
    </SectionCard>
  );
}

function FocusDialog({ data, onClose }: { data: DevelopmentOverview; onClose: () => void }) {
  const t = useTranslations("development.focus");
  const tc = useTranslations("common");
  const toast = useToast();
  const actions = useDevelopmentActions();
  const [selected, setSelected] = useState<string[]>(data.focusAttributeIds);
  const full = selected.length >= data.maxFocus;

  return (
    <Dialog open onClose={onClose} title={t("dialogTitle")}>
      <form
        className="flex flex-col gap-4"
        data-testid="focus-dialog"
        onSubmit={(event) => {
          event.preventDefault();
          actions.setFocus.mutate(
            { attributeIds: selected },
            {
              onSuccess: () => {
                onClose();
                toast.show(t("saved"));
              },
            },
          );
        }}
      >
        <p className="text-sm text-muted-foreground">{t("dialogHint", { max: data.maxFocus })}</p>
        {data.attributes.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noAttributes")}</p>
        ) : (
          <fieldset className="flex flex-col gap-1">
            <legend className="sr-only">{t("dialogTitle")}</legend>
            {data.attributes.map(({ attribute }) => {
              const checked = selected.includes(attribute.id);
              const disabled = !checked && full;
              return (
                <label
                  key={attribute.id}
                  className={cn(
                    "flex items-center gap-3 rounded-md px-2 py-2 text-sm",
                    disabled ? "opacity-50" : "cursor-pointer hover:bg-surface-muted",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled}
                    onChange={() =>
                      setSelected((list) =>
                        checked
                          ? list.filter((id) => id !== attribute.id)
                          : [...list, attribute.id],
                      )
                    }
                    className="size-4 accent-primary"
                  />
                  <AttributeName attribute={attribute} />
                </label>
              );
            })}
          </fieldset>
        )}
        <p
          className={cn("text-xs tabular-nums", full ? "text-warning" : "text-muted-foreground")}
          aria-live="polite"
          data-testid="focus-count"
        >
          {t("selected", { count: selected.length, max: data.maxFocus })}
          {full ? ` · ${t("limit")}` : null}
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {tc("cancel")}
          </Button>
          <Button type="submit" disabled={actions.setFocus.isPending}>
            {t("save")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** 最近成长最快: measured from Growth XP — explicitly not the same as the chosen focus. */
function RecentGrowthCard({ data }: { data: DevelopmentOverview }) {
  const t = useTranslations("development.recent");
  const format = useFormatter();
  const attributeOf = new Map(data.attributes.map((s) => [s.attribute.id, s.attribute]));
  const top = data.recentGrowth[0]?.growthXp ?? 0;
  return (
    <SectionCard
      icon={<TrendingUp className="size-4" aria-hidden />}
      title={t("title")}
      testId="recent-growth"
    >
      {data.recentGrowth.length === 0 ? (
        <EmptyState title={t("empty", { days: RECENT_WINDOW_DAYS })} testId="recent-growth-empty" />
      ) : (
        <ol className="flex flex-col gap-3">
          {data.recentGrowth.map((row) => {
            const attribute = attributeOf.get(row.attributeId);
            if (!attribute) return null;
            return (
              <li key={row.attributeId} className="flex flex-col gap-1.5" data-testid="recent-row">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <AttributeName
                    attribute={attribute}
                    href={attributeHref(attribute.id)}
                    className="font-medium"
                  />
                  <span className="shrink-0 font-semibold tabular-nums">
                    {t("xp", { xp: format.number(row.growthXp) })}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-surface-muted" aria-hidden>
                  <div
                    className="h-full rounded-full bg-primary/70"
                    style={{ width: `${Math.round((row.growthXp / top) * 100)}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ol>
      )}
      <p className="mt-auto text-xs text-muted-foreground">
        {t("hint", { days: RECENT_WINDOW_DAYS })}
      </p>
    </SectionCard>
  );
}
