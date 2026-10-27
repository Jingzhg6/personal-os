"use client";

import { Plus, Settings2, Sprout, X } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { splitByWeight, xpRules } from "@/modules/character/domain";
import { useAttributeLabel, useDevelopmentAttributes } from "@/modules/character/ui";
import { Button } from "@/shared/ui/button";
import { ColorDot } from "@/shared/ui/color";
import { Popover } from "@/shared/ui/popover";
import { Select } from "@/shared/ui/select";

import type { TaskContribution, TaskDetail } from "../domain";
import { useTaskActions } from "./use-task-data";

const weights = [3, 2, 1] as const;
const taskRule = xpRules.find((rule) => rule.key === "task.completion")!;

/**
 * 成长贡献: which development attributes this task helps grow. Independent of the task's area;
 * most tasks have none. The XP amount itself comes from the shared rule — the weights only decide
 * how it is split.
 */
export function ContributionsField({ task }: { task: TaskDetail }) {
  const t = useTranslations("tasks.contributions");
  const label = useAttributeLabel();
  const actions = useTaskActions();
  const { data: attributes = [] } = useDevelopmentAttributes();
  const byId = new Map(attributes.map((a) => [a.id, a]));
  const available = attributes.filter(
    (a) => !a.archivedAt && !task.contributions.some((c) => c.attributeId === a.id),
  );

  const save = (contributions: TaskContribution[]) =>
    actions.update.mutate({ id: task.id, patch: { contributions } });

  // Same computation as the server: overall XP of the completion, split by weight.
  const total = taskRule.grant({ ...task, taskId: task.id, completedAt: new Date() }).amount;
  const parts = splitByWeight(total, task.contributions);

  return (
    <section className="flex flex-col gap-2" aria-labelledby="task-contributions">
      <div className="flex items-center justify-between gap-2">
        <h3 id="task-contributions" className="flex items-center gap-1.5 text-sm font-medium">
          <Sprout className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
          {t("title")}
        </h3>
        <Popover
          align="end"
          trigger={(props) => (
            <Button variant="ghost" size="sm" {...props}>
              <Plus />
              {t("add")}
            </Button>
          )}
        >
          {(close) => (
            <div className="flex w-56 flex-col gap-1">
              <ul role="listbox" aria-label={t("search")} className="max-h-60 overflow-y-auto">
                {available.map((attribute) => (
                  <li key={attribute.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={false}
                      onClick={() => {
                        close();
                        save([...task.contributions, { attributeId: attribute.id, weight: 2 }]);
                      }}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-muted"
                    >
                      <ColorDot color={attribute.color} />
                      {attribute.icon ? <span aria-hidden>{attribute.icon}</span> : null}
                      <span className="truncate">{label(attribute)}</span>
                    </button>
                  </li>
                ))}
                {available.length === 0 ? (
                  <li className="px-2 py-1.5 text-sm text-muted-foreground">{t("empty")}</li>
                ) : null}
              </ul>
              <Link
                href="/character/attributes"
                className="flex items-center gap-1.5 border-t border-border px-2 pt-2 pb-1 text-xs text-primary hover:underline"
              >
                <Settings2 className="size-3.5" aria-hidden />
                {t("manage")}
              </Link>
            </div>
          )}
        </Popover>
      </div>

      {task.contributions.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("none")}</p>
      ) : (
        <>
          <ul aria-label={t("title")} className="flex flex-col gap-1" data-testid="contributions">
            {task.contributions.map((contribution) => {
              const attribute = byId.get(contribution.attributeId);
              if (!attribute) return null;
              const name = label(attribute);
              return (
                <li
                  key={contribution.attributeId}
                  data-testid="contribution"
                  className="flex items-center gap-2 rounded-md px-1 py-1"
                >
                  <ColorDot color={attribute.color} />
                  {attribute.icon ? <span aria-hidden>{attribute.icon}</span> : null}
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {name}
                    {attribute.archivedAt ? (
                      <span className="ml-1.5 text-xs text-muted-foreground">{t("archived")}</span>
                    ) : null}
                  </span>
                  <Select
                    aria-label={t("weight", { name })}
                    value={String(contribution.weight)}
                    className="h-8 w-24"
                    onChange={(event) =>
                      save(
                        task.contributions.map((c) =>
                          c.attributeId === contribution.attributeId
                            ? { ...c, weight: Number(event.target.value) }
                            : c,
                        ),
                      )
                    }
                  >
                    {weights.map((weight) => (
                      <option key={weight} value={weight}>
                        {t(`weights.${weight}`)}
                      </option>
                    ))}
                  </Select>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() =>
                      save(
                        task.contributions.filter(
                          (c) => c.attributeId !== contribution.attributeId,
                        ),
                      )
                    }
                    aria-label={t("remove", { name })}
                    title={t("remove", { name })}
                  >
                    <X />
                  </Button>
                </li>
              );
            })}
          </ul>
          <p
            className="text-xs text-muted-foreground tabular-nums"
            data-testid="contribution-preview"
          >
            {t("preview", {
              total,
              parts: parts
                .map((part) => {
                  const attribute = byId.get(part.attributeId);
                  return attribute ? `${label(attribute)} +${part.amount}` : "";
                })
                .filter(Boolean)
                .join(" · "),
            })}
          </p>
        </>
      )}
      <p className="text-xs text-muted-foreground">{t("hint")}</p>
    </section>
  );
}
