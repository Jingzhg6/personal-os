"use client";

import {
  AlertTriangle,
  ArrowRight,
  Building2,
  Coins,
  LineChart,
  PieChart,
  Plus,
  Settings2,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";

import { cn } from "@/shared/lib/cn";
import { buttonVariants } from "@/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { PageHeader } from "@/shared/ui/page-header";

import {
  dec,
  historyRanges,
  isNegative,
  isZero,
  STALE_AFTER_DAYS,
  toDisplayNumber,
  type FinanceOverview,
  type HistoryRange,
} from "../domain";
import { useDay, useMoney } from "./format";
import { NetWorthChart } from "./net-worth-chart";
import { useFinanceHistory, useFinanceOverview } from "./use-finance";

export function FinanceOverviewView({ title }: { title: string }) {
  const t = useTranslations("finance.overview");
  const { data } = useFinanceOverview();

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6" data-testid="finance-overview">
      <PageHeader
        title={title}
        description={t("description")}
        actions={
          data?.hasAccounts ? (
            <>
              <Link
                href="/finance/accounts"
                className={buttonVariants({ variant: "secondary" })}
                data-testid="finance-manage"
              >
                <Settings2 aria-hidden />
                {t("manage")}
              </Link>
              <Link
                href="/finance/snapshot"
                className={buttonVariants()}
                data-testid="finance-record"
              >
                <Plus aria-hidden />
                {t("record")}
              </Link>
            </>
          ) : null
        }
      />
      {!data ? null : !data.hasSnapshots ? (
        <EmptyOverview hasAccounts={data.hasAccounts} />
      ) : (
        <Overview data={data} />
      )}
    </div>
  );
}

function EmptyOverview({ hasAccounts }: { hasAccounts: boolean }) {
  const t = useTranslations("finance.empty");
  const steps = [t("step1"), t("step2"), t("step3")];
  return (
    <Card data-testid="finance-empty">
      <CardContent className="flex flex-col items-center gap-5 py-10 text-center">
        <span className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Wallet className="size-6" aria-hidden />
        </span>
        <h2 className="text-lg font-semibold">{t("title")}</h2>
        <ol className="flex flex-col gap-2 text-left text-sm text-muted-foreground">
          {steps.map((step, i) => (
            <li key={step} className="flex items-center gap-2">
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium",
                  hasAccounts && i < 2
                    ? "border-success bg-success/15 text-success"
                    : "border-border",
                )}
              >
                {i + 1}
              </span>
              {step}
            </li>
          ))}
        </ol>
        <Link
          href={hasAccounts ? "/finance/snapshot" : "/finance/accounts"}
          className={buttonVariants()}
          data-testid="finance-empty-action"
        >
          {hasAccounts ? t("recordFirst") : t("start")}
          <ArrowRight aria-hidden />
        </Link>
      </CardContent>
    </Card>
  );
}

function Overview({ data }: { data: FinanceOverview }) {
  const t = useTranslations("finance.overview");
  const money = useMoney();
  const day = useDay();
  const base = data.baseCurrency;
  const warnings = data.missing.length + data.stale.length + data.unconverted.length;

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" data-testid="finance-net-worth">
          <CardContent className="flex flex-col gap-3">
            <div className="text-sm text-muted-foreground">{t("netWorth")}</div>
            <div
              className={cn(
                "text-3xl font-semibold tracking-tight tabular-nums sm:text-4xl",
                isNegative(dec(data.netWorth)) && "text-danger",
              )}
              data-testid="finance-net-worth-value"
            >
              {money(data.netWorth, base)}
            </div>
            <div className="text-sm text-muted-foreground">
              {data.lastValuationDate
                ? t("lastValuation", { date: day(data.lastValuationDate) })
                : t("noValuation")}
            </div>
            <ChangeSummary data={data} />
          </CardContent>
        </Card>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-1">
          <Figure label={t("assets")} value={money(data.assets, base)} testId="finance-assets" />
          <Figure
            label={t("liabilities")}
            value={money(data.liabilities, base)}
            testId="finance-liabilities"
          />
        </div>
      </div>

      {warnings > 0 ? (
        <Card className="border-warning/60" data-testid="finance-warnings">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="size-4 text-warning" aria-hidden />
              {t("warnings")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-1.5 text-sm">
              {data.unconverted.map((u) => (
                <li key={`u-${u.accountId}`} data-testid="finance-warning-unconverted">
                  {t("unconverted", { name: u.name, amount: money(u.amount, u.currency) })}
                </li>
              ))}
              {data.missing.map((m) => (
                <li key={`m-${m.accountId}`} data-testid="finance-warning-missing">
                  {t("missing", { name: m.name, provider: m.providerName })}
                </li>
              ))}
              {data.stale.map((s) => (
                <li key={`s-${s.accountId}`} data-testid="finance-warning-stale">
                  {t("stale", {
                    name: s.name,
                    days: STALE_AFTER_DAYS,
                    date: day(s.valuationDate),
                  })}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <HistoryCard />

      <div className="grid gap-4 lg:grid-cols-2">
        <Section icon={<PieChart className="size-4" />} title={t("byCategory")}>
          <Bars
            testId="finance-by-category"
            rows={data.byCategory.map((c) => ({
              key: c.category,
              label: <CategoryName category={c.category} />,
              value: c.value,
              detail: t("accountCount", { count: c.accountCount }),
            }))}
            currency={base}
          />
        </Section>
        <Section icon={<Building2 className="size-4" />} title={t("byProvider")}>
          <Bars
            testId="finance-by-provider"
            rows={data.byProvider.map((p) => ({
              key: p.providerId,
              label: p.name,
              value: p.value,
              detail: t("accountCount", { count: p.accountCount }),
            }))}
            currency={base}
          />
        </Section>
      </div>

      <Section icon={<Coins className="size-4" />} title={t("byCurrency")}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="finance-by-currency">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th scope="col" className="py-2 pr-4 font-medium">
                  {t("currency")}
                </th>
                <th scope="col" className="py-2 pr-4 text-right font-medium">
                  {t("currencyAssets")}
                </th>
                <th scope="col" className="py-2 text-right font-medium">
                  {t("currencyLiabilities")}
                </th>
              </tr>
            </thead>
            <tbody>
              {data.byCurrency.map((c) => (
                <tr key={c.currency} className="border-b border-border/60 last:border-0">
                  <th scope="row" className="py-2 pr-4 text-left font-medium">
                    {c.currency}
                  </th>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {money(c.assets, c.currency)}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {isZero(dec(c.liabilities)) ? "—" : money(c.liabilities, c.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <p className="text-xs text-muted-foreground">{t("notMeasured")}</p>
    </>
  );
}

function ChangeSummary({ data }: { data: FinanceOverview }) {
  const t = useTranslations("finance.overview");
  const money = useMoney();
  const day = useDay();
  const base = data.baseCurrency;
  if (!data.change) {
    return (
      <p className="text-xs text-muted-foreground" data-testid="finance-change">
        {t("noChange")}
      </p>
    );
  }
  const { change } = data;
  const parts = [
    { key: "balance", label: t("changeBalance"), value: change.balance },
    { key: "fx", label: t("changeFx"), value: change.fx },
    { key: "accounts", label: t("changeAccounts"), value: change.accounts },
  ].filter((part) => part.key !== "accounts" || !isZero(dec(part.value)));
  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3" data-testid="finance-change">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span
          className={cn(
            "text-lg font-semibold tabular-nums",
            isNegative(dec(change.total))
              ? "text-danger"
              : !isZero(dec(change.total)) && "text-success",
          )}
          data-testid="finance-change-total"
        >
          {money(change.total, base, { signed: true })}
        </span>
        <span className="text-sm text-muted-foreground">
          {t("change", { date: day(change.since) })}
        </span>
      </div>
      <dl className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
        {parts.map((part) => (
          <div key={part.key} className="flex gap-1.5" data-testid={`finance-change-${part.key}`}>
            <dt className="text-muted-foreground">{part.label}</dt>
            <dd className="font-medium tabular-nums">
              {money(part.value, base, { signed: true })}
            </dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-muted-foreground">{t("changeHint")}</p>
    </div>
  );
}

function HistoryCard() {
  const t = useTranslations("finance.overview");
  const tc = useTranslations("finance.chart");
  const [range, setRange] = useState<HistoryRange>("90d");
  const { data } = useFinanceHistory(range);
  const points = data?.points ?? [];
  return (
    <Section
      icon={<LineChart className="size-4" />}
      title={t("history")}
      testId="finance-history"
      action={
        <div
          role="radiogroup"
          aria-label={t("rangeLabel")}
          className="inline-flex rounded-md border border-border p-0.5"
        >
          {historyRanges.map((r) => (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={r === range}
              onClick={() => setRange(r)}
              className={cn(
                "rounded px-2.5 py-1 text-xs font-medium",
                r === range
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t(`ranges.${r}`)}
            </button>
          ))}
        </div>
      }
    >
      {!data ? (
        <div className="h-[200px]" />
      ) : points.length === 0 ? (
        <p className="flex h-[200px] items-center justify-center rounded-md border border-dashed border-border text-sm text-muted-foreground">
          {t("historyEmpty")}
        </p>
      ) : (
        <NetWorthChart
          points={points}
          baseCurrency={data.baseCurrency}
          rangeName={t(`ranges.${range}`)}
        />
      )}
      <p className="text-xs text-muted-foreground">{t("historyHint")}</p>
      {points.some((p) => p.carried > 0 || p.unconverted > 0) ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span
            className="inline-block size-2.5 rounded-full border-2 border-primary bg-surface"
            aria-hidden
          />
          {tc("hollow")}
        </p>
      ) : null}
    </Section>
  );
}

function CategoryName({ category }: { category: string }) {
  const t = useTranslations("finance.categories");
  return <>{t(category as "cash")}</>;
}

function Bars({
  rows,
  currency,
  testId,
}: {
  rows: { key: string; label: ReactNode; value: string; detail: string }[];
  currency: string;
  testId: string;
}) {
  const money = useMoney();
  const max = Math.max(...rows.map((r) => Math.abs(toDisplayNumber(dec(r.value)))), 1);
  return (
    <ul className="flex flex-col gap-3" data-testid={testId}>
      {rows.map((row) => {
        const value = toDisplayNumber(dec(row.value));
        return (
          <li key={row.key} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate font-medium">{row.label}</span>
              <span className="shrink-0 tabular-nums">{money(row.value, currency)}</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-muted" aria-hidden>
              <div
                className={cn("h-full rounded-full", value < 0 ? "bg-danger" : "bg-primary")}
                style={{ width: `${(Math.abs(value) / max) * 100}%` }}
              />
            </div>
            <span className="text-xs text-muted-foreground">{row.detail}</span>
          </li>
        );
      })}
    </ul>
  );
}

function Figure({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <Card data-testid={testId}>
      <CardContent className="flex flex-col gap-1">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className="text-xl font-semibold tabular-nums">{value}</span>
      </CardContent>
    </Card>
  );
}

function Section({
  icon,
  title,
  action,
  children,
  testId,
}: {
  icon: ReactNode;
  title: string;
  action?: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <Card className="flex flex-col" data-testid={testId}>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2">
          <span className="text-primary">{icon}</span>
          {title}
        </CardTitle>
        {action}
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3">{children}</CardContent>
    </Card>
  );
}
