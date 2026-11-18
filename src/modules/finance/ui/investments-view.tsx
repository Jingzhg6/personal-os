"use client";

import { Archive, ArchiveRestore, Pencil, Plus, Trash2 } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useId, useState, type FormEvent, type ReactNode } from "react";

import { cn } from "@/shared/lib/cn";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { Dialog } from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { PageHeader } from "@/shared/ui/page-header";
import { Select } from "@/shared/ui/select";
import { useToast } from "@/shared/ui/toast";

import {
  commonCurrencies,
  dec,
  investmentAccountTypes,
  investmentKinds,
  isNegative,
  isZero,
  transactionKinds,
  type AccountView,
  type CurrencyTotals,
  type HoldingView,
  type InvestmentAccountType,
  type InvestmentKind,
  type TransactionKind,
  type TransactionRecord,
} from "../domain";
import { useDay, useMoney } from "./format";
import { useFinanceActions, useFinanceOverview, usePortfolio } from "./use-finance";

const ALL = "all";
const textareaClass =
  "w-full rounded-md border border-input bg-surface px-3 py-2 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30";
const PERCENT = { style: "percent", maximumFractionDigits: 2, signDisplay: "exceptZero" } as const;

type Confirm =
  | { kind: "archive"; account: AccountView }
  | { kind: "holding"; holding: HoldingView }
  | { kind: "transaction"; transaction: TransactionRecord };

/**
 * Investments (V3): accounts, their holdings and transactions. All figures come from the
 * transactions and the prices the user enters (see the domain); totals are per currency.
 */
export function InvestmentsView({ title }: { title: string }) {
  const t = useTranslations("finance.investments");
  const { data: portfolio, isPending } = usePortfolio();
  const { data: overview } = useFinanceOverview();
  const actions = useFinanceActions();
  const toast = useToast();
  const money = useMoney();
  const day = useDay();
  const selectId = useId();
  const [selected, setSelected] = useState<string>(ALL);
  const [showArchived, setShowArchived] = useState(false);
  const [accountForm, setAccountForm] = useState<{ account?: AccountView } | null>(null);
  const [holdingForm, setHoldingForm] = useState<{
    account: AccountView;
    holding?: HoldingView;
  } | null>(null);
  const [txForm, setTxForm] = useState<{
    account: AccountView;
    transaction?: TransactionRecord;
    holdingId?: string;
  } | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);

  const accounts = (portfolio?.accounts ?? []).filter((a) => showArchived || !a.archivedAt);
  const account = accounts.find((a) => a.id === selected) ?? null;
  const transactionsOf = (id: string) =>
    (portfolio?.transactions ?? []).filter((x) => x.accountId === id);
  const done = (message: string, close: () => void) => () => {
    toast.show(message);
    close();
  };

  function runConfirm() {
    if (!confirm) return;
    const close = () => setConfirm(null);
    if (confirm.kind === "archive") {
      actions.archiveInvestmentAccount.mutate(
        { id: confirm.account.id, archived: !confirm.account.archivedAt },
        { onSuccess: done(t("saved"), close) },
      );
    } else if (confirm.kind === "holding") {
      actions.deleteHolding.mutate(
        { id: confirm.holding.id },
        { onSuccess: done(t("deleted"), close) },
      );
    } else {
      actions.deleteTransaction.mutate(
        { id: confirm.transaction.id },
        { onSuccess: done(t("deleted"), close) },
      );
    }
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6" data-testid="finance-investments">
      <PageHeader
        title={title}
        description={t("description")}
        actions={
          <Button onClick={() => setAccountForm({})} data-testid="investment-account-add">
            <Plus aria-hidden />
            {t("newAccount")}
          </Button>
        }
      />

      {isPending ? (
        <div className="h-40 animate-pulse rounded-lg bg-surface-muted" aria-hidden />
      ) : (portfolio?.accounts.length ?? 0) === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {t("noAccounts")}
          </CardContent>
        </Card>
      ) : (
        <>
          {portfolio!.totals.map((totals) => (
            <TotalsCard key={totals.currency} totals={totals} />
          ))}

          <div className="flex flex-wrap items-end gap-4">
            <div className="flex min-w-56 flex-col gap-1.5">
              <Label htmlFor={selectId}>{t("accountLabel")}</Label>
              <Select
                id={selectId}
                value={account ? account.id : ALL}
                onChange={(e) => setSelected(e.target.value)}
                data-testid="investment-account-select"
              >
                <option value={ALL}>{t("allAccounts")}</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} · {a.currency}
                  </option>
                ))}
              </Select>
            </div>
            <label className="flex items-center gap-2 pb-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
              />
              {t("showArchived")}
            </label>
          </div>

          {account ? (
            <AccountDetail
              account={account}
              transactions={transactionsOf(account.id)}
              onEdit={() => setAccountForm({ account })}
              onArchive={() => setConfirm({ kind: "archive", account })}
              onAddHolding={() => setHoldingForm({ account })}
              onEditHolding={(holding) => setHoldingForm({ account, holding })}
              onDeleteHolding={(holding) => setConfirm({ kind: "holding", holding })}
              onAddTransaction={(holdingId) => setTxForm({ account, holdingId })}
              onEditTransaction={(transaction) => setTxForm({ account, transaction })}
              onDeleteTransaction={(transaction) =>
                setConfirm({ kind: "transaction", transaction })
              }
            />
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {accounts.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => setSelected(a.id)}
                  className="text-left"
                  data-testid="investment-account-card"
                >
                  <Card className="h-full transition-colors hover:border-primary/50">
                    <CardContent className="flex flex-col gap-2">
                      <AccountTitle account={a} />
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-xs text-muted-foreground">{t("accountValue")}</span>
                        <span className="text-lg font-semibold tabular-nums">
                          {money(a.value, a.currency)}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-x-4 text-xs text-muted-foreground">
                        <span>
                          {t("holdings")} {a.holdings.length}
                        </span>
                        <span>
                          {t("cash")}{" "}
                          {a.cash === null ? t("cashUntracked") : money(a.cash, a.currency)}
                        </span>
                        <Signed
                          label={t("unrealized")}
                          value={a.unrealized}
                          currency={a.currency}
                        />
                      </div>
                    </CardContent>
                  </Card>
                </button>
              ))}
            </div>
          )}
          <p className="text-xs text-muted-foreground">{t("noDoubleCount")}</p>
        </>
      )}

      {accountForm ? (
        <AccountFormDialog
          account={accountForm.account}
          defaultCurrency={overview?.baseCurrency ?? "EUR"}
          pending={
            actions.createInvestmentAccount.isPending || actions.updateInvestmentAccount.isPending
          }
          onClose={() => setAccountForm(null)}
          onSubmit={(values) => {
            const close = () => setAccountForm(null);
            if (accountForm.account)
              actions.updateInvestmentAccount.mutate(
                { id: accountForm.account.id, patch: values },
                { onSuccess: done(t("saved"), close) },
              );
            else
              actions.createInvestmentAccount.mutate(values, {
                onSuccess: (created) => {
                  setSelected(created.id);
                  done(t("created"), close)();
                },
              });
          }}
        />
      ) : null}

      {holdingForm ? (
        <HoldingFormDialog
          holding={holdingForm.holding}
          currency={holdingForm.account.currency}
          today={overview?.today ?? ""}
          pending={actions.createHolding.isPending || actions.updateHolding.isPending}
          onClose={() => setHoldingForm(null)}
          onSubmit={(values) => {
            const close = () => setHoldingForm(null);
            if (holdingForm.holding)
              actions.updateHolding.mutate(
                { id: holdingForm.holding.id, patch: values },
                { onSuccess: done(t("saved"), close) },
              );
            else
              actions.createHolding.mutate(
                { accountId: holdingForm.account.id, ...values },
                { onSuccess: done(t("created"), close) },
              );
          }}
        />
      ) : null}

      {txForm ? (
        <TransactionFormDialog
          account={txForm.account}
          transaction={txForm.transaction}
          holdingId={txForm.holdingId}
          today={overview?.today ?? ""}
          pending={actions.createTransaction.isPending || actions.updateTransaction.isPending}
          onClose={() => setTxForm(null)}
          onSubmit={(values) => {
            const close = () => setTxForm(null);
            if (txForm.transaction)
              actions.updateTransaction.mutate(
                { id: txForm.transaction.id, patch: values },
                { onSuccess: done(t("saved"), close) },
              );
            else
              actions.createTransaction.mutate(
                { accountId: txForm.account.id, ...values },
                { onSuccess: done(t("created"), close) },
              );
          }}
        />
      ) : null}

      <ConfirmDialog
        open={confirm !== null}
        title={
          confirm?.kind === "archive"
            ? t("archiveTitle", { name: confirm.account.name })
            : confirm?.kind === "holding"
              ? t("deleteHoldingTitle", { name: confirm.holding.name })
              : t("deleteTransactionTitle")
        }
        description={
          confirm?.kind === "archive"
            ? confirm.account.archivedAt
              ? undefined
              : t("archiveBody")
            : confirm?.kind === "holding"
              ? t("deleteHoldingBody", { count: confirm.holding.transactionCount })
              : confirm?.kind === "transaction"
                ? t("deleteTransactionBody", {
                    kind: t(`txKinds.${confirm.transaction.kind}`),
                    date: day(confirm.transaction.tradeDate),
                    amount: money(confirm.transaction.amount, confirm.transaction.currency),
                  })
                : undefined
        }
        tone={confirm?.kind === "archive" ? "primary" : "danger"}
        confirmLabel={
          confirm?.kind === "archive"
            ? confirm.account.archivedAt
              ? t("unarchive")
              : t("archive")
            : t("delete")
        }
        pending={
          actions.archiveInvestmentAccount.isPending ||
          actions.deleteHolding.isPending ||
          actions.deleteTransaction.isPending
        }
        onCancel={() => setConfirm(null)}
        onConfirm={runConfirm}
      />
    </div>
  );
}

function Signed({ label, value, currency }: { label?: string; value: string; currency: string }) {
  const money = useMoney();
  const d = dec(value);
  return (
    <span
      className={cn(
        "tabular-nums",
        isZero(d) ? "" : isNegative(d) ? "text-danger" : "text-success",
      )}
    >
      {label ? `${label} ` : ""}
      {money(value, currency, { signed: true })}
    </span>
  );
}

function TotalsCard({ totals }: { totals: CurrencyTotals }) {
  const t = useTranslations("finance.investments");
  const money = useMoney();
  const format = useFormatter();
  const c = totals.currency;
  const figures: { key: string; label: string; value: ReactNode }[] = [
    { key: "invested", label: t("invested"), value: money(totals.invested, c) },
    { key: "cost", label: t("costBasis"), value: money(totals.costBasis, c) },
    { key: "market", label: t("marketValue"), value: money(totals.marketValue, c) },
    {
      key: "realized",
      label: t("realized"),
      value: <Signed value={totals.realized} currency={c} />,
    },
    {
      key: "unrealized",
      label: t("unrealized"),
      value: <Signed value={totals.unrealized} currency={c} />,
    },
    {
      key: "return",
      label: t("return"),
      value: totals.returnRatio === null ? "—" : format.number(Number(totals.returnRatio), PERCENT),
    },
  ];
  return (
    <Card data-testid="investment-totals" data-currency={c}>
      <CardHeader>
        <CardTitle className="text-sm">{t("totalsTitle", { currency: c })}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {figures.map((f) => (
            <div key={f.key} className="min-w-0">
              <dt className="text-xs text-muted-foreground">{f.label}</dt>
              <dd className="truncate font-semibold tabular-nums" data-testid={`totals-${f.key}`}>
                {f.value}
              </dd>
            </div>
          ))}
        </dl>
        <p className="text-xs text-muted-foreground">
          {t("returnHint")}
          {totals.estimated > 0 ? ` ${t("estimatedNote", { count: totals.estimated })}` : ""}
        </p>
      </CardContent>
    </Card>
  );
}

function AccountTitle({ account }: { account: AccountView }) {
  const t = useTranslations("finance.investments");
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <span className="truncate font-medium">{account.name}</span>
      <Badge>{t(`accountTypes.${account.accountType}`)}</Badge>
      <Badge>{account.currency}</Badge>
      {account.legacy ? <Badge>{t("legacy")}</Badge> : null}
      {account.archivedAt ? <Badge className="text-warning">{t("archived")}</Badge> : null}
      {account.institution ? (
        <span className="text-xs text-muted-foreground">{account.institution}</span>
      ) : null}
    </div>
  );
}

function AccountDetail({
  account,
  transactions,
  onEdit,
  onArchive,
  onAddHolding,
  onEditHolding,
  onDeleteHolding,
  onAddTransaction,
  onEditTransaction,
  onDeleteTransaction,
}: {
  account: AccountView;
  transactions: TransactionRecord[];
  onEdit: () => void;
  onArchive: () => void;
  onAddHolding: () => void;
  onEditHolding: (h: HoldingView) => void;
  onDeleteHolding: (h: HoldingView) => void;
  onAddTransaction: (holdingId?: string) => void;
  onEditTransaction: (x: TransactionRecord) => void;
  onDeleteTransaction: (x: TransactionRecord) => void;
}) {
  const t = useTranslations("finance.investments");
  const money = useMoney();
  const day = useDay();
  const c = account.currency;
  const archived = account.archivedAt !== null;
  const holdingName = new Map(account.holdings.map((h) => [h.id, h.name]));
  return (
    <div className="flex flex-col gap-4" data-testid="investment-account">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <AccountTitle account={account} />
            {account.notes ? (
              <p className="text-xs whitespace-pre-wrap text-muted-foreground">{account.notes}</p>
            ) : null}
          </div>
          <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm tabular-nums">
            <div>
              <dt className="text-xs text-muted-foreground">{t("accountValue")}</dt>
              <dd className="font-semibold" data-testid="investment-account-value">
                {money(account.value, c)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t("marketValue")}</dt>
              <dd>{money(account.holdingsValue, c)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t("cash")}</dt>
              <dd data-testid="investment-account-cash">
                {account.cash === null ? t("cashUntracked") : money(account.cash, c)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t("realized")}</dt>
              <dd>
                <Signed value={account.realized} currency={c} />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t("unrealized")}</dt>
              <dd>
                <Signed value={account.unrealized} currency={c} />
              </dd>
            </div>
          </dl>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={onEdit}
              data-testid="investment-account-edit"
            >
              <Pencil aria-hidden />
              {t("edit")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onArchive}
              data-testid="investment-account-archive"
            >
              {archived ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
              {archived ? t("unarchive") : t("archive")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-sm">{t("holdings")}</CardTitle>
          {archived ? null : (
            <Button size="sm" variant="secondary" onClick={onAddHolding} data-testid="holding-add">
              <Plus aria-hidden />
              {t("addHolding")}
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {account.holdings.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">{t("noHoldings")}</p>
          ) : (
            <div className="-mx-2 overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="px-2 py-1.5 font-normal">{t("holdingName")}</th>
                    <th className="px-2 py-1.5 text-right font-normal">{t("units")}</th>
                    <th className="px-2 py-1.5 text-right font-normal">{t("averagePrice")}</th>
                    <th className="px-2 py-1.5 text-right font-normal">{t("costBasis")}</th>
                    <th className="px-2 py-1.5 text-right font-normal">{t("price")}</th>
                    <th className="px-2 py-1.5 text-right font-normal">{t("marketValue")}</th>
                    <th className="px-2 py-1.5 text-right font-normal">{t("unrealized")}</th>
                    <th className="px-2 py-1.5 text-right font-normal">{t("realized")}</th>
                    <th className="px-2 py-1.5" />
                  </tr>
                </thead>
                <tbody>
                  {account.holdings.map((h) => (
                    <tr key={h.id} className="border-t border-border" data-testid="holding-row">
                      <td className="px-2 py-2">
                        <div className="flex min-w-0 flex-col">
                          <span className="font-medium">{h.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {t(`kinds.${h.kind}`)}
                            {h.ticker ? ` · ${h.ticker}` : ""}
                          </span>
                        </div>
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums" data-testid="holding-units">
                        {h.units === null ? t("unitsUnknown") : Number(h.units).toLocaleString()}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {h.averagePrice === null ? "—" : Number(h.averagePrice).toLocaleString()}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums" data-testid="holding-cost">
                        {money(h.costBasis, c)}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {h.currentPrice === null ? "—" : Number(h.currentPrice).toLocaleString()}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        <div className="flex flex-col items-end">
                          <span data-testid="holding-value">{money(h.marketValue, c)}</span>
                          <span
                            className={cn(
                              "text-[11px]",
                              h.valuation === "cost" ? "text-warning" : "text-muted-foreground",
                            )}
                            data-testid="holding-valuation"
                          >
                            {h.valuation === "price"
                              ? h.priceDate
                                ? t("valuation.price", { date: day(h.priceDate, true) })
                                : t("valuation.priceNoDate")
                              : t(`valuation.${h.valuation}`)}
                          </span>
                        </div>
                      </td>
                      <td className="px-2 py-2 text-right" data-testid="holding-unrealized">
                        {h.unrealized === null ? "—" : <Signed value={h.unrealized} currency={c} />}
                      </td>
                      <td className="px-2 py-2 text-right" data-testid="holding-realized">
                        <Signed value={h.realized} currency={c} />
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex justify-end gap-0.5">
                          {archived ? null : (
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={t("addTransaction")}
                              onClick={() => onAddTransaction(h.id)}
                              data-testid="holding-trade"
                            >
                              <Plus aria-hidden />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={t("editHolding")}
                            onClick={() => onEditHolding(h)}
                            data-testid="holding-edit"
                          >
                            <Pencil aria-hidden />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={t("deleteHolding")}
                            onClick={() => onDeleteHolding(h)}
                            data-testid="holding-delete"
                          >
                            <Trash2 aria-hidden />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-sm">{t("transactions")}</CardTitle>
          {archived ? null : (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => onAddTransaction()}
              data-testid="transaction-add"
            >
              <Plus aria-hidden />
              {t("addTransaction")}
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {transactions.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">{t("noTransactions")}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border" data-testid="transaction-list">
              {transactions.map((x) => (
                <li
                  key={x.id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2 text-sm"
                  data-testid="transaction-row"
                >
                  <span className="w-24 shrink-0 text-xs text-muted-foreground tabular-nums">
                    {day(x.tradeDate)}
                  </span>
                  <Badge>{t(`txKinds.${x.kind}`)}</Badge>
                  <span className="min-w-0 flex-1 truncate">
                    {x.holdingId ? holdingName.get(x.holdingId) : t("noHolding")}
                    {x.quantity ? (
                      <span className="text-xs text-muted-foreground">
                        {" "}
                        · {Number(x.quantity).toLocaleString()}
                        {x.unitPrice ? ` × ${Number(x.unitPrice).toLocaleString()}` : ""}
                      </span>
                    ) : null}
                    {x.opening ? (
                      <span className="text-xs text-muted-foreground"> · {t("opening")}</span>
                    ) : null}
                    {x.notes ? (
                      <span className="block text-xs text-muted-foreground">{x.notes}</span>
                    ) : null}
                  </span>
                  <span className="tabular-nums">{money(x.amount, x.currency)}</span>
                  {!isZero(dec(x.fee)) ? (
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {t("fee")} {money(x.fee, x.currency)}
                    </span>
                  ) : null}
                  <div className="flex gap-0.5">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t("editTransaction")}
                      onClick={() => onEditTransaction(x)}
                      data-testid="transaction-edit"
                    >
                      <Pencil aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t("deleteTransaction")}
                      onClick={() => onDeleteTransaction(x)}
                      data-testid="transaction-delete"
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ----------------------------------------------------------------------------------- forms */

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

const blank = (v: string) => (v.trim() === "" ? null : v.trim());

function AccountFormDialog({
  account,
  defaultCurrency,
  pending,
  onClose,
  onSubmit,
}: {
  account?: AccountView;
  defaultCurrency: string;
  pending: boolean;
  onClose: () => void;
  onSubmit: (values: {
    name: string;
    institution: string | null;
    accountType: InvestmentAccountType;
    currency: string;
    notes: string | null;
  }) => void;
}) {
  const t = useTranslations("finance.investments");
  const id = useId();
  const [name, setName] = useState(account?.name ?? "");
  const [institution, setInstitution] = useState(account?.institution ?? "");
  const [accountType, setAccountType] = useState<InvestmentAccountType>(
    account?.accountType ?? "brokerage",
  );
  const [currency, setCurrency] = useState(account?.currency ?? defaultCurrency);
  const [notes, setNotes] = useState(account?.notes ?? "");
  const locked = (account?.holdings.length ?? 0) > 0;
  const currencies = [...new Set([currency, ...commonCurrencies])];

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    onSubmit({
      name: name.trim(),
      institution: blank(institution),
      accountType,
      currency,
      notes: blank(notes),
    });
  }
  return (
    <Dialog open onClose={onClose} title={account ? t("editAccount") : t("newAccount")}>
      <form onSubmit={submit} className="flex flex-col gap-4" data-testid="investment-account-form">
        <Field id={`${id}-name`} label={t("accountName")}>
          <Input
            id={`${id}-name`}
            autoFocus
            value={name}
            maxLength={80}
            placeholder={t("accountNamePlaceholder")}
            onChange={(e) => setName(e.target.value)}
            data-testid="investment-account-name"
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id={`${id}-inst`} label={t("institution")}>
            <Input
              id={`${id}-inst`}
              value={institution}
              maxLength={80}
              onChange={(e) => setInstitution(e.target.value)}
            />
          </Field>
          <Field id={`${id}-type`} label={t("accountType")}>
            <Select
              id={`${id}-type`}
              value={accountType}
              onChange={(e) => setAccountType(e.target.value as InvestmentAccountType)}
            >
              {investmentAccountTypes.map((x) => (
                <option key={x} value={x}>
                  {t(`accountTypes.${x}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field id={`${id}-cur`} label={t("currency")}>
            <Select
              id={`${id}-cur`}
              value={currency}
              disabled={locked}
              onChange={(e) => setCurrency(e.target.value)}
              data-testid="investment-account-currency"
            >
              {currencies.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field id={`${id}-notes`} label={t("notes")}>
          <textarea
            id={`${id}-notes`}
            rows={2}
            maxLength={500}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className={textareaClass}
          />
        </Field>
        <div className="flex justify-end">
          <Button
            type="submit"
            disabled={pending || !name.trim()}
            data-testid="investment-account-submit"
          >
            {account ? t("save") : t("create")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function HoldingFormDialog({
  holding,
  currency,
  today,
  pending,
  onClose,
  onSubmit,
}: {
  holding?: HoldingView;
  currency: string;
  today: string;
  pending: boolean;
  onClose: () => void;
  onSubmit: (values: {
    name: string;
    kind: InvestmentKind;
    ticker: string | null;
    notes: string | null;
    currentPrice: string | null;
    priceDate: string | null;
    currentValue: string | null;
  }) => void;
}) {
  const t = useTranslations("finance.investments");
  const id = useId();
  const [name, setName] = useState(holding?.name ?? "");
  const [kind, setKind] = useState<InvestmentKind>(holding?.kind ?? "etf");
  const [ticker, setTicker] = useState(holding?.ticker ?? "");
  const [price, setPrice] = useState(holding?.currentPrice ?? "");
  const [priceDate, setPriceDate] = useState(holding?.priceDate ?? today);
  const [value, setValue] = useState(holding?.currentValue ?? "");
  const [notes, setNotes] = useState(holding?.notes ?? "");

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    onSubmit({
      name: name.trim(),
      kind,
      ticker: blank(ticker),
      notes: blank(notes),
      currentPrice: blank(price),
      priceDate: blank(price) ? priceDate || null : null,
      currentValue: blank(value),
    });
  }
  return (
    <Dialog open onClose={onClose} title={holding ? t("editHolding") : t("addHolding")}>
      <form onSubmit={submit} className="flex flex-col gap-4" data-testid="holding-form">
        <Field id={`${id}-name`} label={t("holdingName")}>
          <Input
            id={`${id}-name`}
            autoFocus
            value={name}
            maxLength={80}
            placeholder={t("holdingNamePlaceholder")}
            onChange={(e) => setName(e.target.value)}
            data-testid="holding-name"
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id={`${id}-kind`} label={t("kind")}>
            <Select
              id={`${id}-kind`}
              value={kind}
              onChange={(e) => setKind(e.target.value as InvestmentKind)}
              data-testid="holding-kind"
            >
              {investmentKinds.map((x) => (
                <option key={x} value={x}>
                  {t(`kinds.${x}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field id={`${id}-ticker`} label={t("ticker")}>
            <Input
              id={`${id}-ticker`}
              value={ticker}
              maxLength={30}
              onChange={(e) => setTicker(e.target.value)}
            />
          </Field>
          <Field id={`${id}-price`} label={`${t("currentPrice")} (${currency})`}>
            <Input
              id={`${id}-price`}
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              data-testid="holding-price"
            />
          </Field>
          <Field id={`${id}-pdate`} label={t("priceDate")}>
            <Input
              id={`${id}-pdate`}
              type="date"
              value={priceDate}
              onChange={(e) => setPriceDate(e.target.value)}
            />
          </Field>
        </div>
        <Field id={`${id}-value`} label={`${t("currentValue")} (${currency})`}>
          <Input
            id={`${id}-value`}
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            data-testid="holding-manual-value"
          />
        </Field>
        <p className="text-xs text-muted-foreground">{t("valuationHint")}</p>
        <Field id={`${id}-notes`} label={t("notes")}>
          <textarea
            id={`${id}-notes`}
            rows={2}
            maxLength={500}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className={textareaClass}
          />
        </Field>
        <div className="flex justify-end">
          <Button type="submit" disabled={pending || !name.trim()} data-testid="holding-submit">
            {holding ? t("save") : t("create")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function TransactionFormDialog({
  account,
  transaction,
  holdingId,
  today,
  pending,
  onClose,
  onSubmit,
}: {
  account: AccountView;
  transaction?: TransactionRecord;
  holdingId?: string;
  today: string;
  pending: boolean;
  onClose: () => void;
  onSubmit: (values: {
    kind: TransactionKind;
    holdingId: string | null;
    tradeDate: string;
    quantity: string | null;
    unitPrice: string | null;
    amount: string | null;
    fee: string | null;
    notes: string | null;
  }) => void;
}) {
  const t = useTranslations("finance.investments");
  const id = useId();
  const [kind, setKind] = useState<TransactionKind>(transaction?.kind ?? "buy");
  const [holding, setHolding] = useState(
    transaction?.holdingId ?? holdingId ?? account.holdings[0]?.id ?? "",
  );
  const [tradeDate, setTradeDate] = useState(transaction?.tradeDate ?? today);
  const [quantity, setQuantity] = useState(transaction?.quantity ?? "");
  const [unitPrice, setUnitPrice] = useState(transaction?.unitPrice ?? "");
  const [amount, setAmount] = useState(transaction?.amount ?? "");
  const [fee, setFee] = useState(transaction && transaction.fee !== "0" ? transaction.fee : "");
  const [notes, setNotes] = useState(transaction?.notes ?? "");
  const trade = kind === "buy" || kind === "sell";
  const accountOnly = kind === "deposit" || kind === "withdrawal";
  const c = account.currency;
  const valid =
    tradeDate !== "" &&
    (!trade || holding !== "") &&
    (kind !== "sell" || quantity.trim() !== "") &&
    (amount.trim() !== "" || (quantity.trim() !== "" && unitPrice.trim() !== ""));

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid) return;
    onSubmit({
      kind,
      holdingId: accountOnly ? null : blank(holding),
      tradeDate,
      quantity: accountOnly ? null : blank(quantity),
      unitPrice: accountOnly ? null : blank(unitPrice),
      amount: blank(amount),
      fee: blank(fee),
      notes: blank(notes),
    });
  }
  return (
    <Dialog open onClose={onClose} title={transaction ? t("editTransaction") : t("addTransaction")}>
      <form onSubmit={submit} className="flex flex-col gap-4" data-testid="transaction-form">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id={`${id}-kind`} label={t("txKind")}>
            <Select
              id={`${id}-kind`}
              value={kind}
              onChange={(e) => setKind(e.target.value as TransactionKind)}
              data-testid="transaction-kind"
            >
              {transactionKinds.map((x) => (
                <option key={x} value={x}>
                  {t(`txKinds.${x}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field id={`${id}-date`} label={t("tradeDate")}>
            <Input
              id={`${id}-date`}
              type="date"
              value={tradeDate}
              onChange={(e) => setTradeDate(e.target.value)}
              data-testid="transaction-date"
            />
          </Field>
        </div>
        {accountOnly ? null : (
          <Field id={`${id}-holding`} label={t("holding")}>
            <Select
              id={`${id}-holding`}
              value={holding}
              onChange={(e) => setHolding(e.target.value)}
              data-testid="transaction-holding"
            >
              {trade ? null : <option value="">{t("noHolding")}</option>}
              {account.holdings.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {accountOnly ? null : (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id={`${id}-qty`} label={t("quantity")}>
              <Input
                id={`${id}-qty`}
                inputMode="decimal"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                data-testid="transaction-quantity"
              />
            </Field>
            <Field id={`${id}-price`} label={`${t("unitPrice")} (${c})`}>
              <Input
                id={`${id}-price`}
                inputMode="decimal"
                value={unitPrice}
                onChange={(e) => setUnitPrice(e.target.value)}
                data-testid="transaction-price"
              />
            </Field>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id={`${id}-amount`} label={`${t("amount")} (${c})`}>
            <Input
              id={`${id}-amount`}
              inputMode="decimal"
              value={amount}
              placeholder={trade ? t("amountAuto") : undefined}
              onChange={(e) => setAmount(e.target.value)}
              data-testid="transaction-amount"
            />
          </Field>
          <Field id={`${id}-fee`} label={`${t("fee")} (${c})`}>
            <Input
              id={`${id}-fee`}
              inputMode="decimal"
              value={fee}
              onChange={(e) => setFee(e.target.value)}
              data-testid="transaction-fee"
            />
          </Field>
        </div>
        <Field id={`${id}-notes`} label={t("notes")}>
          <textarea
            id={`${id}-notes`}
            rows={2}
            maxLength={500}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className={textareaClass}
          />
        </Field>
        <div className="flex justify-end">
          <Button type="submit" disabled={pending || !valid} data-testid="transaction-submit">
            {transaction ? t("save") : t("create")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
