"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState, type FormEvent } from "react";

import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card, CardContent } from "@/shared/ui/card";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { Dialog } from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { PageHeader } from "@/shared/ui/page-header";
import { Select } from "@/shared/ui/select";
import { useToast } from "@/shared/ui/toast";

import { investmentKinds, type FinanceInvestment, type InvestmentKind } from "../domain";
import { useDay, useMoney } from "./format";
import { useFinanceActions, useFinanceOverview, useInvestments } from "./use-finance";

const textareaClass =
  "w-full rounded-md border border-input bg-surface px-3 py-2 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30";

export function InvestmentsView({ title }: { title: string }) {
  const t = useTranslations("finance.investments");
  const tk = useTranslations("finance.investments.kinds");
  const { data: investments } = useInvestments();
  const { data: overview } = useFinanceOverview();
  const actions = useFinanceActions();
  const toast = useToast();
  const money = useMoney();
  const day = useDay();
  const [form, setForm] = useState<{ investment?: FinanceInvestment } | null>(null);
  const [deleting, setDeleting] = useState<FinanceInvestment | null>(null);
  const base = overview?.baseCurrency ?? null;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6" data-testid="finance-investments">
      <PageHeader
        title={title}
        description={t("description")}
        actions={
          <Button onClick={() => setForm({})} disabled={!base} data-testid="investment-add">
            <Plus aria-hidden />
            {t("add")}
          </Button>
        }
      />

      {overview && overview.investments.count > 0 ? (
        <div className="grid grid-cols-2 gap-4">
          <Card>
            <CardContent className="flex flex-col gap-1">
              <span className="text-sm text-muted-foreground">{t("totalCost")}</span>
              <span className="text-xl font-semibold tabular-nums" data-testid="investments-cost">
                {money(overview.investments.cost, overview.baseCurrency)}
              </span>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex flex-col gap-1">
              <span className="text-sm text-muted-foreground">{t("totalValue")}</span>
              <span className="text-xl font-semibold tabular-nums" data-testid="investments-value">
                {money(overview.investments.value, overview.baseCurrency)}
              </span>
            </CardContent>
          </Card>
        </div>
      ) : null}

      <p className="text-xs text-muted-foreground">{t("noDoubleCount")}</p>

      {investments && investments.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {t("empty")}
          </CardContent>
        </Card>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="investment-list">
          {investments?.map((i) => (
            <li key={i.id} data-testid="investment-row">
              <Card>
                <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-medium">{i.name}</span>
                      <Badge>{tk(i.kind)}</Badge>
                      {i.currentValue == null ? (
                        <Badge className="text-warning">{t("unvalued")}</Badge>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                      <span>{t("boughtOn", { date: day(i.purchaseDate) })}</span>
                      {i.quantity ? (
                        <span>{t("quantityLabel", { quantity: i.quantity })}</span>
                      ) : null}
                      {base && i.currency !== base ? (
                        <span className="text-warning">
                          {t("otherCurrency", { currency: i.currency })}
                        </span>
                      ) : null}
                    </div>
                    {i.notes ? (
                      <p className="text-xs whitespace-pre-wrap text-muted-foreground">{i.notes}</p>
                    ) : null}
                  </div>
                  <dl className="grid grid-cols-2 gap-x-4 text-right text-sm tabular-nums">
                    <dt className="text-xs text-muted-foreground">{t("costLabel")}</dt>
                    <dt className="text-xs text-muted-foreground">{t("valueLabel")}</dt>
                    <dd data-testid="investment-cost">{money(i.costAmount, i.currency)}</dd>
                    <dd data-testid="investment-value">
                      {i.currentValue == null ? "—" : money(i.currentValue, i.currency)}
                    </dd>
                  </dl>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t("edit")}
                      onClick={() => setForm({ investment: i })}
                      data-testid="investment-edit"
                    >
                      <Pencil aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t("delete")}
                      onClick={() => setDeleting(i)}
                      data-testid="investment-delete"
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {form && base ? (
        <InvestmentFormDialog
          investment={form.investment}
          currency={form.investment?.currency ?? base}
          today={overview?.today ?? ""}
          pending={actions.createInvestment.isPending || actions.updateInvestment.isPending}
          onClose={() => setForm(null)}
          onSubmit={(values) => {
            const done = (message: string) => () => {
              toast.show(message);
              setForm(null);
            };
            if (form.investment) {
              actions.updateInvestment.mutate(
                { id: form.investment.id, patch: values },
                { onSuccess: done(t("saved")) },
              );
            } else {
              actions.createInvestment.mutate(values, { onSuccess: done(t("created")) });
            }
          }}
        />
      ) : null}

      <ConfirmDialog
        open={deleting !== null}
        title={deleting ? t("deleteTitle", { name: deleting.name }) : ""}
        description={t("deleteDescription")}
        confirmLabel={t("delete")}
        pending={actions.deleteInvestment.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() =>
          deleting &&
          actions.deleteInvestment.mutate(
            { id: deleting.id },
            {
              onSuccess: () => {
                toast.show(t("deleted"));
                setDeleting(null);
              },
            },
          )
        }
      />
    </div>
  );
}

interface InvestmentValues {
  name: string;
  kind: InvestmentKind;
  costAmount: string;
  purchaseDate: string;
  quantity: string | null;
  currentValue: string | null;
  notes: string | null;
}

function InvestmentFormDialog({
  investment,
  currency,
  today,
  pending,
  onClose,
  onSubmit,
}: {
  investment?: FinanceInvestment;
  currency: string;
  today: string;
  pending: boolean;
  onClose: () => void;
  onSubmit: (values: InvestmentValues) => void;
}) {
  const t = useTranslations("finance.investments");
  const tk = useTranslations("finance.investments.kinds");
  const id = useId();
  const [name, setName] = useState(investment?.name ?? "");
  const [kind, setKind] = useState<InvestmentKind>(investment?.kind ?? "fund");
  const [cost, setCost] = useState(investment?.costAmount ?? "");
  const [purchaseDate, setPurchaseDate] = useState(investment?.purchaseDate ?? today);
  const [quantity, setQuantity] = useState(investment?.quantity ?? "");
  const [value, setValue] = useState(investment?.currentValue ?? "");
  const [notes, setNotes] = useState(investment?.notes ?? "");
  const valid = name.trim() !== "" && cost.trim() !== "" && purchaseDate !== "";

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid) return;
    onSubmit({
      name: name.trim(),
      kind,
      costAmount: cost.trim(),
      purchaseDate,
      quantity: quantity.trim() || null,
      currentValue: value.trim() || null,
      notes: notes.trim() || null,
    });
  }

  return (
    <Dialog open onClose={onClose} title={investment ? t("edit") : t("add")}>
      <form onSubmit={submit} className="flex flex-col gap-4" data-testid="investment-form">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-name`}>{t("name")}</Label>
          <Input
            id={`${id}-name`}
            autoFocus
            value={name}
            maxLength={80}
            placeholder={t("namePlaceholder")}
            onChange={(e) => setName(e.target.value)}
            data-testid="investment-name"
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-kind`}>{t("kind")}</Label>
            <Select
              id={`${id}-kind`}
              value={kind}
              onChange={(e) => setKind(e.target.value as InvestmentKind)}
              data-testid="investment-kind"
            >
              {investmentKinds.map((k) => (
                <option key={k} value={k}>
                  {tk(k)}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-date`}>{t("purchaseDate")}</Label>
            <Input
              id={`${id}-date`}
              type="date"
              value={purchaseDate}
              max={today || undefined}
              onChange={(e) => setPurchaseDate(e.target.value)}
              data-testid="investment-date"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-cost`}>{t("cost", { currency })}</Label>
            <Input
              id={`${id}-cost`}
              inputMode="decimal"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              data-testid="investment-cost-input"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-qty`}>{t("quantity")}</Label>
            <Input
              id={`${id}-qty`}
              inputMode="decimal"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              data-testid="investment-quantity"
            />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-value`}>{t("currentValue", { currency })}</Label>
          <Input
            id={`${id}-value`}
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            data-testid="investment-value-input"
          />
          <span className="text-xs text-muted-foreground">{t("currentValueHint")}</span>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-notes`}>{t("notes")}</Label>
          <textarea
            id={`${id}-notes`}
            rows={2}
            maxLength={500}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className={textareaClass}
          />
        </div>
        <div className="flex justify-end">
          <Button type="submit" disabled={pending || !valid} data-testid="investment-submit">
            {investment ? t("save") : t("create")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
