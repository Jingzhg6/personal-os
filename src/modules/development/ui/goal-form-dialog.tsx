"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState, type FormEvent } from "react";

import { isActiveAttribute } from "@/modules/character/domain";
import { useAttributeLabel, useDevelopmentAttributes } from "@/modules/character/ui";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { ColorDot } from "@/shared/ui/color";
import { Dialog } from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Select } from "@/shared/ui/select";

import {
  goalPriorities,
  goalWeights,
  type CreateGoalInput,
  type DevelopmentGoal,
  type GoalAttribute,
} from "../domain";

export const textareaClass =
  "w-full rounded-md border border-input bg-surface px-3 py-2 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30";

/** Create / edit a development goal. */
export function GoalFormDialog({
  open,
  goal,
  pending,
  onClose,
  onSubmit,
}: {
  open: boolean;
  /** Present when editing. */
  goal?: DevelopmentGoal;
  pending?: boolean;
  onClose: () => void;
  onSubmit: (values: CreateGoalInput) => void;
}) {
  const t = useTranslations("development.form");
  const tg = useTranslations("development.goals");
  const tc = useTranslations("common");
  const label = useAttributeLabel();
  const { data: allAttributes = [] } = useDevelopmentAttributes();
  const ids = { title: useId(), description: useId(), priority: useId(), target: useId() };
  const [title, setTitle] = useState(goal?.title ?? "");
  const [description, setDescription] = useState(goal?.description ?? "");
  const [priority, setPriority] = useState(goal?.priority ?? 2);
  const [targetDate, setTargetDate] = useState<string | null>(goal?.targetDate ?? null);
  const [attributes, setAttributes] = useState<GoalAttribute[]>(goal?.attributes ?? []);

  const byId = new Map(allAttributes.map((a) => [a.id, a]));
  // Active attributes, plus any archived one the goal already names (it may stay).
  const selectable = allAttributes.filter(
    (a) => isActiveAttribute(a) || attributes.some((link) => link.attributeId === a.id),
  );
  const valid = title.trim() !== "" && attributes.length > 0;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid) return;
    onSubmit({
      title: title.trim(),
      description: description.trim() || null,
      priority,
      targetDate,
      attributes,
    });
  }

  return (
    <Dialog open={open} onClose={onClose} title={goal ? t("editTitle") : t("newTitle")}>
      <form onSubmit={submit} className="flex flex-col gap-4" data-testid="goal-form">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={ids.title}>{t("title")}</Label>
          <Input
            id={ids.title}
            autoFocus
            value={title}
            maxLength={120}
            placeholder={t("titlePlaceholder")}
            onChange={(event) => setTitle(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={ids.description}>{t("description")}</Label>
          <textarea
            id={ids.description}
            rows={3}
            maxLength={2000}
            value={description}
            placeholder={t("descriptionPlaceholder")}
            onChange={(event) => setDescription(event.target.value)}
            className={textareaClass}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={ids.priority}>{t("priority")}</Label>
            <Select
              id={ids.priority}
              value={priority}
              onChange={(event) => setPriority(Number(event.target.value))}
            >
              {goalPriorities.map((value) => (
                <option key={value} value={value}>
                  {tg(`priority.${value}`)}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={ids.target}>{t("targetDate")}</Label>
            <Input
              id={ids.target}
              type="date"
              value={targetDate ?? ""}
              onChange={(event) => setTargetDate(event.target.value || null)}
            />
          </div>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">{t("attributes")}</legend>
          {/* Toggle chips rather than a popover: a modal dialog scrolls and would clip one. */}
          <div className="flex flex-wrap gap-1.5" data-testid="goal-form-attribute-options">
            {selectable.map((attribute) => {
              const selected = attributes.some((link) => link.attributeId === attribute.id);
              return (
                <button
                  key={attribute.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() =>
                    setAttributes((list) =>
                      selected
                        ? list.filter((link) => link.attributeId !== attribute.id)
                        : [...list, { attributeId: attribute.id, weight: 2 }],
                    )
                  }
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm",
                    selected
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground hover:bg-surface-muted hover:text-foreground",
                  )}
                >
                  <ColorDot color={attribute.color} />
                  {attribute.icon ? <span aria-hidden>{attribute.icon}</span> : null}
                  {label(attribute)}
                </button>
              );
            })}
            {selectable.length === 0 ? (
              <span className="text-sm text-muted-foreground">{t("noMoreAttributes")}</span>
            ) : null}
          </div>
          {attributes.length > 0 ? (
            <ul className="flex flex-col gap-1" data-testid="goal-form-attributes">
              {attributes.map((link) => {
                const attribute = byId.get(link.attributeId);
                if (!attribute) return null;
                const name = label(attribute);
                return (
                  <li key={link.attributeId} className="flex items-center gap-2 rounded-md py-1">
                    <ColorDot color={attribute.color} />
                    {attribute.icon ? <span aria-hidden>{attribute.icon}</span> : null}
                    <span className="min-w-0 flex-1 truncate text-sm">{name}</span>
                    <Select
                      aria-label={t("weight", { name })}
                      value={link.weight}
                      className="h-8 w-24"
                      onChange={(event) =>
                        setAttributes((list) =>
                          list.map((item) =>
                            item.attributeId === link.attributeId
                              ? { ...item, weight: Number(event.target.value) }
                              : item,
                          ),
                        )
                      }
                    >
                      {goalWeights.map((weight) => (
                        <option key={weight} value={weight}>
                          {t(`weights.${weight}`)}
                        </option>
                      ))}
                    </Select>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("removeAttribute", { name })}
                      title={t("removeAttribute", { name })}
                      onClick={() =>
                        setAttributes((list) =>
                          list.filter((item) => item.attributeId !== link.attributeId),
                        )
                      }
                    >
                      <X />
                    </Button>
                  </li>
                );
              })}
            </ul>
          ) : null}
          <p className="text-xs text-muted-foreground">{t("attributesHint")}</p>
        </fieldset>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>
            {tc("cancel")}
          </Button>
          <Button type="submit" disabled={pending || !valid}>
            {goal ? t("save") : t("create")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
