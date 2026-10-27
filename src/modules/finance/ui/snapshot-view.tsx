"use client";

import { AlertTriangle, ChevronLeft, CornerDownLeft, Info } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useState, type FormEvent } from "react";

import { cn } from "@/shared/lib/cn";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { PageHeader } from "@/shared/ui/page-header";
import { useToast } from "@/shared/ui/toast";

import {
  amountProblem,
  dec,
  isIsoDate,
  rateProblem,
  sub,
  sum,
  toMoney,
  valuate,
  type BatchDraft,
  type BatchDraftAccount,
} from "../domain";
import { useDay, useMoney } from "./format";
import { useBatchDraft, useFinanceActions, useFinanceOverview } from "./use-finance";

/** The "new balance snapshot" workflow: one valuation date, many accounts, one atomic save. */
export function SnapshotView({ title }: { title: string }) {
  const t = useTranslations("finance.snapshot");
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { data: overview } = useFinanceOverview();
  const requested = params.get("date");
  const date = requested && isIsoDate(requested) ? requested : (overview?.today ?? null);
  const { data: draft } = useBatchDraft(date);
  const dateId = useId();

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6" data-testid="finance-snapshot">
      <Link
        href="/finance"
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" aria-hidden />
        {t("back")}
      </Link>
      <PageHeader title={title} description={t("description")} />
      <Card>
        <CardContent className="flex flex-col gap-1.5">
          <Label htmlFor={dateId}>{t("date")}</Label>
          <Input
            id={dateId}
            type="date"
            className="w-48"
            value={date ?? ""}
            max={overview?.today}
            onChange={(event) => {
              const value = event.target.value;
              if (isIsoDate(value)) router.replace(`${pathname}?date=${value}`, { scroll: false });
            }}
            data-testid="snapshot-date"
          />
        </CardContent>
      </Card>
      {draft && draft.valuationDate === date ? (
        <BatchForm key={draft.valuationDate} draft={draft} />
      ) : null}
    </div>
  );
}

function BatchForm({ draft }: { draft: BatchDraft }) {
  const t = useTranslations("finance.snapshot");
  const money = useMoney();
  const toast = useToast();
  const router = useRouter();
  const { saveBatch } = useFinanceActions();
  const base = draft.baseCurrency;
  const editable = draft.accounts.filter((a) => !a.account.archivedAt);
  const correcting = draft.accounts.filter((a) => a.existing).length;

  const [amounts, setAmounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(draft.accounts.map((a) => [a.account.id, a.existing?.amount ?? ""])),
  );
  const [rates, setRates] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = { ...draft.defaultRates };
    for (const a of draft.accounts) {
      if (a.existing?.fxSource === "manual" && a.existing.fxRate) {
        initial[a.account.currency] = a.existing.fxRate;
      }
    }
    return initial;
  });
  const [submitted, setSubmitted] = useState(false);

  if (draft.accounts.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          <p>{t("noAccounts")}</p>
          <Link href="/finance/accounts" className="mt-2 inline-block text-primary hover:underline">
            {t("back")}
          </Link>
        </CardContent>
      </Card>
    );
  }

  const filled = editable.filter((a) => (amounts[a.account.id] ?? "").trim() !== "");
  const foreign = [
    ...new Set(filled.map((a) => a.account.currency).filter((c) => c !== base)),
  ].sort();
  const rateOf = (currency: string) => {
    const value = (rates[currency] ?? "").trim();
    return value && !rateProblem(value) ? value : null;
  };
  const amountErrors = filled.filter((a) =>
    amountProblem(amounts[a.account.id]!, a.account.currency),
  );
  const rateErrors = foreign.filter((c) => (rates[c] ?? "").trim() && rateProblem(rates[c]!));
  const missingRates = foreign.filter((c) => !(rates[c] ?? "").trim());

  // Provisional totals of this batch only, with the same exact arithmetic the server uses.
  const values = filled
    .filter(
      (a) =>
        a.account.includeInNetWorth && !amountProblem(amounts[a.account.id]!, a.account.currency),
    )
    .map((a) => ({
      kind: a.account.kind,
      value: valuate(amounts[a.account.id]!, a.account.currency, base, rateOf(a.account.currency))
        .baseAmount,
    }))
    .filter((v): v is { kind: "asset" | "liability"; value: string } => v.value !== null);
  const assets = sum(values.filter((v) => v.kind === "asset").map((v) => dec(v.value)));
  const liabilities = sum(values.filter((v) => v.kind === "liability").map((v) => dec(v.value)));

  function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    if (filled.length === 0) {
      toast.show(t("nothing"), "error");
      return;
    }
    if (amountErrors.length > 0 || rateErrors.length > 0) {
      toast.show(t("invalid"), "error");
      return;
    }
    saveBatch.mutate(
      {
        valuationDate: draft.valuationDate,
        entries: filled.map((a) => ({
          accountId: a.account.id,
          amount: amounts[a.account.id]!.trim(),
        })),
        rates: Object.fromEntries(
          foreign.filter((c) => (rates[c] ?? "").trim()).map((c) => [c, rates[c]!.trim()]),
        ),
        overwrite: filled.some((a) => a.existing),
      },
      {
        onSuccess: (result) => {
          toast.show(t("saved", { count: result.saved }));
          router.push("/finance");
        },
      },
    );
  }

  const groups = new Map<string, BatchDraftAccount[]>();
  for (const a of draft.accounts) {
    groups.set(a.providerName, [...(groups.get(a.providerName) ?? []), a]);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-6" data-testid="snapshot-form" noValidate>
      {correcting > 0 ? (
        <p
          className="flex items-start gap-2 rounded-md border border-warning/60 bg-warning/10 px-3 py-2 text-sm"
          data-testid="snapshot-correcting"
        >
          <Info className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          {t("correcting", { count: correcting })}
        </p>
      ) : null}

      {[...groups].map(([provider, accounts]) => (
        <Card key={provider}>
          <CardHeader>
            <CardTitle>{provider}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col divide-y divide-border">
            {accounts.map((a) => (
              <AccountEntry
                key={a.account.id}
                entry={a}
                base={base}
                amount={amounts[a.account.id] ?? ""}
                rate={rateOf(a.account.currency)}
                showErrors={submitted}
                onChange={(value) => setAmounts((all) => ({ ...all, [a.account.id]: value }))}
              />
            ))}
          </CardContent>
        </Card>
      ))}

      {foreign.length > 0 ? (
        <Card data-testid="snapshot-rates">
          <CardHeader>
            <CardTitle>{t("rates")}</CardTitle>
            <p className="text-sm text-muted-foreground">{t("ratesHint", { base })}</p>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {foreign.map((currency) => (
              <RateInput
                key={currency}
                currency={currency}
                base={base}
                value={rates[currency] ?? ""}
                onChange={(value) => setRates((all) => ({ ...all, [currency]: value }))}
              />
            ))}
            {missingRates.length > 0 ? (
              <p
                className="flex items-start gap-2 text-sm text-foreground"
                role="status"
                data-testid="snapshot-missing-rate"
              >
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                {t("rateMissing", { currencies: missingRates.join("、") })}
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card className="sticky bottom-3 z-10 shadow-md" data-testid="snapshot-summary">
        <CardContent className="flex items-center justify-between gap-3 p-3 sm:p-5">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="hidden text-sm font-medium sm:block">{t("provisional")}</span>
            <dl className="flex flex-wrap gap-x-4 gap-y-0.5 text-sm tabular-nums">
              <div className="hidden gap-1 sm:flex">
                <dt className="text-muted-foreground">{t("assets")}</dt>
                <dd>{money(toMoney(assets, base), base)}</dd>
              </div>
              <div className="hidden gap-1 sm:flex">
                <dt className="text-muted-foreground">{t("liabilities")}</dt>
                <dd>{money(toMoney(liabilities, base), base)}</dd>
              </div>
              <div className="flex gap-1 font-semibold">
                <dt>
                  <span className="sm:hidden">{t("provisional")} · </span>
                  {t("netWorth")}
                </dt>
                <dd data-testid="snapshot-provisional-net">
                  {money(toMoney(sub(assets, liabilities), base), base)}
                </dd>
              </div>
            </dl>
            <span className="hidden text-xs text-muted-foreground sm:block">
              {t("provisionalHint")}
            </span>
          </div>
          <Button type="submit" disabled={saveBatch.isPending} data-testid="snapshot-save">
            {correcting > 0 ? t("saveCorrection") : t("save")}
          </Button>
        </CardContent>
      </Card>
    </form>
  );
}

function AccountEntry({
  entry,
  base,
  amount,
  rate,
  showErrors,
  onChange,
}: {
  entry: BatchDraftAccount;
  base: string;
  amount: string;
  rate: string | null;
  showErrors: boolean;
  onChange: (value: string) => void;
}) {
  const t = useTranslations("finance.snapshot");
  const tp = useTranslations("finance.snapshot.amountProblems");
  const money = useMoney();
  const day = useDay();
  const id = useId();
  const { account, previous } = entry;
  const archived = account.archivedAt !== null;
  const trimmed = amount.trim();
  const problem = trimmed ? amountProblem(trimmed, account.currency) : null;
  const preview =
    trimmed && !problem && account.currency !== base
      ? valuate(trimmed, account.currency, base, rate).baseAmount
      : null;

  return (
    <div
      className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between"
      data-testid="snapshot-entry"
      data-account={account.name}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <label htmlFor={id} className="flex flex-wrap items-center gap-1.5 font-medium">
          <span className="sr-only">
            {t("amountFor", { name: account.name, currency: account.currency })}
          </span>
          <span aria-hidden>{account.name}</span>
          <Badge variant="outline">{account.currency}</Badge>
          {archived ? <Badge>{t("archivedAccount")}</Badge> : null}
        </label>
        {account.kind === "liability" ? (
          <span className="text-xs text-muted-foreground">{t("liability")}</span>
        ) : null}
        {previous ? (
          <span className="text-xs text-muted-foreground" data-testid="snapshot-previous">
            {t("previous", {
              amount: money(previous.amount, previous.currency),
              date: day(previous.valuationDate),
            })}
          </span>
        ) : null}
      </div>
      <div className="flex flex-col gap-1 sm:w-56 sm:items-end">
        <div className="flex w-full items-center gap-2">
          <Input
            id={id}
            inputMode="decimal"
            autoComplete="off"
            value={amount}
            disabled={archived}
            placeholder={t("skip")}
            aria-invalid={problem !== null}
            className="text-right tabular-nums"
            onChange={(event) => onChange(event.target.value)}
            data-testid="snapshot-amount"
          />
          {previous && !archived ? (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("usePreviousFor", { name: account.name })}
              title={t("usePrevious")}
              onClick={() => onChange(previous.amount)}
              data-testid="snapshot-use-previous"
            >
              <CornerDownLeft />
            </Button>
          ) : null}
        </div>
        {problem && (showErrors || problem !== "invalid") ? (
          <span className="text-xs text-danger" role="alert">
            {tp(problem)}
          </span>
        ) : preview !== null ? (
          <span
            className="text-xs text-muted-foreground tabular-nums"
            data-testid="snapshot-preview"
          >
            {t("converted", { value: money(preview, base) })}
          </span>
        ) : trimmed && !problem && account.currency !== base ? (
          <span className="text-xs text-warning" data-testid="snapshot-unconverted">
            {t("unconverted")}
          </span>
        ) : !trimmed && !archived ? (
          <span className="text-xs text-muted-foreground">{t("skipped")}</span>
        ) : null}
      </div>
    </div>
  );
}

function RateInput({
  currency,
  base,
  value,
  onChange,
}: {
  currency: string;
  base: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const t = useTranslations("finance.snapshot");
  const tp = useTranslations("finance.snapshot.rateProblems");
  const id = useId();
  const problem = value.trim() ? rateProblem(value.trim()) : null;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Label htmlFor={id} className="w-36 tabular-nums">
        {t("rateFor", { currency, base })}
      </Label>
      <div className="flex flex-col gap-1">
        <Input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          value={value}
          aria-invalid={problem !== null}
          className={cn("w-40 text-right tabular-nums")}
          onChange={(event) => onChange(event.target.value)}
          data-testid={`snapshot-rate-${currency}`}
        />
        {problem ? (
          <span className="text-xs text-danger" role="alert">
            {tp(problem)}
          </span>
        ) : null}
      </div>
    </div>
  );
}
