"use client";

import { useTranslations } from "next-intl";
import { useId, useState, type FormEvent } from "react";

import { Button } from "@/shared/ui/button";
import { Dialog } from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Select } from "@/shared/ui/select";

import { rewardCategories, rewardCosts, type Reward, type RewardCategory } from "../domain";

export interface RewardFormValues {
  name: string;
  emoji: string | null;
  description: string | null;
  category: RewardCategory;
  value: number;
  payWithActive: boolean;
  payWithLevel: boolean;
  repeatable: boolean;
  maxRedemptions: number | null;
  realWorldCostCents: number | null;
  enabled: boolean;
}

const toNumber = (text: string) => (text.trim() === "" ? null : Number(text));

/** Create / edit a store reward. The price is entered as a value; both XP prices follow from it. */
export function RewardFormDialog({
  reward,
  pending,
  onClose,
  onSubmit,
  onDelete,
}: {
  reward?: Reward;
  pending: boolean;
  onClose: () => void;
  onSubmit: (values: RewardFormValues) => void;
  onDelete?: () => void;
}) {
  const t = useTranslations("rewards");
  const tc = useTranslations("common");
  const id = useId();
  const [values, setValues] = useState<RewardFormValues>(() => ({
    name: reward?.name ?? "",
    emoji: reward?.emoji ?? null,
    description: reward?.description ?? null,
    category: reward?.category ?? "treat",
    value: reward?.value ?? 500,
    payWithActive: reward?.payWithActive ?? true,
    payWithLevel: reward?.payWithLevel ?? true,
    repeatable: reward?.repeatable ?? true,
    maxRedemptions: reward?.maxRedemptions ?? null,
    realWorldCostCents: reward?.realWorldCostCents ?? null,
    enabled: reward?.enabled ?? true,
  }));
  const set = (patch: Partial<RewardFormValues>) => setValues((v) => ({ ...v, ...patch }));
  const costs = rewardCosts({
    value: Math.max(1, values.value || 1),
    payWithActive: true,
    payWithLevel: true,
  });
  const valid =
    values.name.trim() !== "" && values.value >= 1 && (values.payWithActive || values.payWithLevel);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid) return;
    onSubmit({
      ...values,
      name: values.name.trim(),
      emoji: values.emoji?.trim() || null,
      description: values.description?.trim() || null,
      maxRedemptions: values.repeatable ? values.maxRedemptions : null,
    });
  }

  return (
    <Dialog open onClose={onClose} title={reward ? t("form.editTitle") : t("form.createTitle")}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid grid-cols-[4rem_1fr] gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-emoji`}>{t("form.emoji")}</Label>
            <Input
              id={`${id}-emoji`}
              value={values.emoji ?? ""}
              maxLength={8}
              className="text-center"
              onChange={(event) => set({ emoji: event.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-name`}>{t("form.name")}</Label>
            <Input
              id={`${id}-name`}
              autoFocus
              value={values.name}
              maxLength={60}
              placeholder={t("form.namePlaceholder")}
              onChange={(event) => set({ name: event.target.value })}
            />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-value`}>{t("form.value")}</Label>
            <Input
              id={`${id}-value`}
              type="number"
              min={1}
              value={values.value || ""}
              onChange={(event) => set({ value: Number(event.target.value) })}
            />
            <span className="text-xs text-muted-foreground tabular-nums">
              {t("form.valueHint", { active: costs.activeXpCost, level: costs.levelXpCost })}
            </span>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-category`}>{t("form.category")}</Label>
            <Select
              id={`${id}-category`}
              value={values.category}
              onChange={(event) => set({ category: event.target.value as RewardCategory })}
            >
              {rewardCategories.map((category) => (
                <option key={category} value={category}>
                  {t(`categories.${category}`)}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-sm font-medium">{t("form.payWith")}</legend>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={values.payWithActive}
                onChange={(event) => set({ payWithActive: event.target.checked })}
              />
              {t("form.payWithActive")}
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={values.payWithLevel}
                onChange={(event) => set({ payWithLevel: event.target.checked })}
              />
              {t("form.payWithLevel")}
            </label>
          </div>
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={values.repeatable}
              onChange={(event) => set({ repeatable: event.target.checked })}
            />
            {t("form.repeatable")}
          </label>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-max`}>{t("form.maxRedemptions")}</Label>
            <Input
              id={`${id}-max`}
              type="number"
              min={1}
              disabled={!values.repeatable}
              placeholder={t("form.maxRedemptionsHint")}
              value={values.maxRedemptions ?? ""}
              onChange={(event) => set({ maxRedemptions: toNumber(event.target.value) })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-real`}>{t("form.realCost")}</Label>
            <Input
              id={`${id}-real`}
              type="number"
              min={0}
              step="0.01"
              value={values.realWorldCostCents === null ? "" : values.realWorldCostCents / 100}
              onChange={(event) => {
                const amount = toNumber(event.target.value);
                set({ realWorldCostCents: amount === null ? null : Math.round(amount * 100) });
              }}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-description`}>{t("form.description")}</Label>
            <Input
              id={`${id}-description`}
              value={values.description ?? ""}
              maxLength={500}
              onChange={(event) => set({ description: event.target.value })}
            />
          </div>
        </div>
        {reward ? (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={values.enabled}
              onChange={(event) => set({ enabled: event.target.checked })}
            />
            {t("form.enabled")}
          </label>
        ) : null}
        <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
          {onDelete ? (
            <Button variant="ghost" className="mr-auto text-danger" onClick={onDelete}>
              {t("form.delete")}
            </Button>
          ) : null}
          <Button variant="secondary" onClick={onClose}>
            {tc("cancel")}
          </Button>
          <Button type="submit" disabled={pending || !valid}>
            {reward ? t("form.save") : t("form.create")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
