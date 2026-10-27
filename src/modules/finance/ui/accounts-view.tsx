"use client";

import {
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  History,
  Lock,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";

import { cn } from "@/shared/lib/cn";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card, CardContent } from "@/shared/ui/card";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { PageHeader } from "@/shared/ui/page-header";

import {
  commonCurrencies,
  isCurrencyCode,
  type FinanceAccount,
  type FinanceProvider,
  type FinanceStructure,
} from "../domain";
import { AccountFormDialog, ProviderFormDialog } from "./forms";
import { useDay, useMoney } from "./format";
import { useFinanceActions, useFinanceStructure } from "./use-finance";

type Confirm =
  | { kind: "deleteProvider"; provider: FinanceProvider }
  | { kind: "archiveProvider"; provider: FinanceProvider }
  | { kind: "deleteAccount"; account: FinanceAccount }
  | { kind: "archiveAccount"; account: FinanceAccount };

export function FinanceAccountsView({ title }: { title: string }) {
  const t = useTranslations("finance.accounts");
  const { data } = useFinanceStructure();
  const actions = useFinanceActions();
  const [providerForm, setProviderForm] = useState<{ provider?: FinanceProvider } | null>(null);
  const [accountForm, setAccountForm] = useState<{
    providerId: string;
    account?: FinanceAccount;
  } | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const active = data?.providers.filter((p) => !p.archivedAt) ?? [];
  const archived = data?.providers.filter((p) => p.archivedAt) ?? [];

  function runConfirm() {
    if (!confirm) return;
    const done = { onSuccess: () => setConfirm(null) };
    if (confirm.kind === "deleteProvider")
      actions.deleteProvider.mutate({ id: confirm.provider.id }, done);
    if (confirm.kind === "archiveProvider")
      actions.archiveProvider.mutate({ id: confirm.provider.id, archived: true }, done);
    if (confirm.kind === "deleteAccount")
      actions.deleteAccount.mutate({ id: confirm.account.id }, done);
    if (confirm.kind === "archiveAccount")
      actions.archiveAccount.mutate({ id: confirm.account.id, archived: true }, done);
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6" data-testid="finance-accounts">
      <PageHeader
        title={title}
        description={t("description")}
        actions={
          <Button onClick={() => setProviderForm({})} data-testid="provider-new">
            <Plus aria-hidden />
            {t("newProvider")}
          </Button>
        }
      />
      {data ? <BaseCurrencyCard data={data} /> : null}
      {data && active.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {t("empty")}
          </CardContent>
        </Card>
      ) : null}
      {data
        ? active.map((provider, i) => (
            <ProviderCard
              key={provider.id}
              provider={provider}
              data={data}
              first={i === 0}
              last={i === active.length - 1}
              onEdit={() => setProviderForm({ provider })}
              onAddAccount={() => setAccountForm({ providerId: provider.id })}
              onEditAccount={(account) => setAccountForm({ providerId: provider.id, account })}
              onConfirm={setConfirm}
            />
          ))
        : null}
      {data && archived.length > 0 ? (
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            aria-expanded={showArchived}
            className="w-fit text-sm text-muted-foreground hover:text-foreground"
            data-testid="providers-archived-toggle"
          >
            {t("archivedProviders", { count: archived.length })}
          </button>
          {showArchived
            ? archived.map((provider) => (
                <ProviderCard
                  key={provider.id}
                  provider={provider}
                  data={data}
                  first
                  last
                  onEdit={() => setProviderForm({ provider })}
                  onAddAccount={() => undefined}
                  onEditAccount={(account) => setAccountForm({ providerId: provider.id, account })}
                  onConfirm={setConfirm}
                />
              ))
            : null}
        </div>
      ) : null}

      {providerForm ? (
        <ProviderFormDialog
          provider={providerForm.provider}
          pending={actions.createProvider.isPending || actions.updateProvider.isPending}
          onClose={() => setProviderForm(null)}
          onSubmit={(values) => {
            const done = { onSuccess: () => setProviderForm(null) };
            if (providerForm.provider) {
              actions.updateProvider.mutate({ id: providerForm.provider.id, patch: values }, done);
            } else {
              actions.createProvider.mutate(values, done);
            }
          }}
        />
      ) : null}
      {accountForm && data ? (
        <AccountFormDialog
          account={accountForm.account}
          baseCurrency={data.baseCurrency}
          pending={actions.createAccount.isPending || actions.updateAccount.isPending}
          onClose={() => setAccountForm(null)}
          onSubmit={(values) => {
            const done = { onSuccess: () => setAccountForm(null) };
            if (accountForm.account) {
              actions.updateAccount.mutate({ id: accountForm.account.id, patch: values }, done);
            } else {
              actions.createAccount.mutate({ ...values, providerId: accountForm.providerId }, done);
            }
          }}
        />
      ) : null}
      <ConfirmDialog
        open={confirm !== null}
        title={
          confirm?.kind === "deleteProvider"
            ? t("deleteProvider", { name: confirm.provider.name })
            : confirm?.kind === "archiveProvider"
              ? t("archiveProviderTitle", { name: confirm.provider.name })
              : confirm?.kind === "deleteAccount"
                ? t("deleteAccount", { name: confirm.account.name })
                : confirm?.kind === "archiveAccount"
                  ? t("archiveAccountTitle", { name: confirm.account.name })
                  : ""
        }
        description={
          confirm?.kind === "deleteProvider"
            ? t("deleteProviderBody")
            : confirm?.kind === "archiveProvider"
              ? t("archiveProviderBody")
              : confirm?.kind === "deleteAccount"
                ? t("deleteAccountBody")
                : t("archiveAccountBody")
        }
        confirmLabel={
          confirm?.kind === "deleteProvider" || confirm?.kind === "deleteAccount"
            ? t("delete")
            : confirm?.kind === "archiveProvider"
              ? t("archiveProvider")
              : t("archive")
        }
        tone={confirm?.kind.startsWith("delete") ? "danger" : "primary"}
        onCancel={() => setConfirm(null)}
        onConfirm={runConfirm}
      />
    </div>
  );
}

function BaseCurrencyCard({ data }: { data: FinanceStructure }) {
  const t = useTranslations("finance.accounts");
  const actions = useFinanceActions();
  const id = useId();
  const [value, setValue] = useState(data.baseCurrency);
  const valid = isCurrencyCode(value.trim().toUpperCase());
  const changed = value.trim().toUpperCase() !== data.baseCurrency;
  return (
    <Card data-testid="base-currency">
      <CardContent className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-40 flex-1 flex-col gap-1.5">
          <Label htmlFor={id}>{t("baseCurrency")}</Label>
          {data.baseLocked ? (
            <div className="flex items-center gap-2 text-sm">
              <span className="font-semibold" data-testid="base-currency-value">
                {data.baseCurrency}
              </span>
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                <Lock className="size-3.5" aria-hidden />
                {t("baseLocked")}
              </span>
            </div>
          ) : (
            <>
              <Input
                id={id}
                value={value}
                maxLength={3}
                list={`${id}-list`}
                className="w-32 uppercase"
                aria-invalid={!valid}
                onChange={(event) => setValue(event.target.value)}
              />
              <datalist id={`${id}-list`}>
                {commonCurrencies.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
              <span className="text-xs text-muted-foreground">{t("baseHint")}</span>
            </>
          )}
        </div>
        {!data.baseLocked && changed ? (
          <Button
            variant="secondary"
            disabled={!valid || actions.setBaseCurrency.isPending}
            onClick={() =>
              actions.setBaseCurrency.mutate({ baseCurrency: value.trim().toUpperCase() })
            }
          >
            {t("save")}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ProviderCard({
  provider,
  data,
  first,
  last,
  onEdit,
  onAddAccount,
  onEditAccount,
  onConfirm,
}: {
  provider: FinanceProvider;
  data: FinanceStructure;
  first: boolean;
  last: boolean;
  onEdit: () => void;
  onAddAccount: () => void;
  onEditAccount: (account: FinanceAccount) => void;
  onConfirm: (confirm: Confirm) => void;
}) {
  const t = useTranslations("finance.accounts");
  const tp = useTranslations("finance.providerTypes");
  const actions = useFinanceActions();
  const accounts = data.accounts.filter((a) => a.providerId === provider.id);
  const archived = provider.archivedAt !== null;

  return (
    <Card data-testid="provider-card" data-provider={provider.name}>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold">{provider.name}</h2>
            <p className="text-sm text-muted-foreground">
              {tp(provider.providerType)}
              {provider.country ? ` · ${provider.country}` : ""}
              {archived ? ` · ${t("archived")}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {!archived ? (
              <>
                <IconButton
                  label={t("moveUp", { name: provider.name })}
                  disabled={first}
                  onClick={() => actions.moveProvider.mutate({ id: provider.id, direction: "up" })}
                >
                  <ArrowUp />
                </IconButton>
                <IconButton
                  label={t("moveDown", { name: provider.name })}
                  disabled={last}
                  onClick={() =>
                    actions.moveProvider.mutate({ id: provider.id, direction: "down" })
                  }
                >
                  <ArrowDown />
                </IconButton>
              </>
            ) : null}
            <IconButton label={t("editProvider")} onClick={onEdit}>
              <Pencil />
            </IconButton>
            {archived ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => actions.archiveProvider.mutate({ id: provider.id, archived: false })}
              >
                <ArchiveRestore aria-hidden />
                {t("restoreProvider")}
              </Button>
            ) : accounts.length === 0 ? (
              <IconButton
                label={t("deleteProvider", { name: provider.name })}
                onClick={() => onConfirm({ kind: "deleteProvider", provider })}
              >
                <Trash2 />
              </IconButton>
            ) : (
              <IconButton
                label={t("archiveProvider")}
                onClick={() => onConfirm({ kind: "archiveProvider", provider })}
              >
                <Archive />
              </IconButton>
            )}
          </div>
        </div>
        {accounts.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noAccounts")}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
            {accounts.map((account, i) => (
              <AccountRow
                key={account.id}
                account={account}
                data={data}
                first={i === 0}
                last={i === accounts.length - 1}
                onEdit={() => onEditAccount(account)}
                onConfirm={onConfirm}
              />
            ))}
          </ul>
        )}
        {!archived ? (
          <Button
            variant="secondary"
            size="sm"
            className="w-fit"
            onClick={onAddAccount}
            data-testid="account-new"
          >
            <Plus aria-hidden />
            {t("newAccount")}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

function AccountRow({
  account,
  data,
  first,
  last,
  onEdit,
  onConfirm,
}: {
  account: FinanceAccount;
  data: FinanceStructure;
  first: boolean;
  last: boolean;
  onEdit: () => void;
  onConfirm: (confirm: Confirm) => void;
}) {
  const t = useTranslations("finance.accounts");
  const tt = useTranslations("finance.accountTypes");
  const tk = useTranslations("finance.kinds");
  const money = useMoney();
  const day = useDay();
  const actions = useFinanceActions();
  const latest = data.latest[account.id];
  const archived = account.archivedAt !== null;

  return (
    <li
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5",
        archived && "opacity-70",
      )}
      data-testid="account-row"
      data-account={account.name}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <Link
            href={`/finance/accounts/${account.id}`}
            className="truncate font-medium hover:underline"
            aria-label={t("history", { name: account.name })}
          >
            {account.name}
          </Link>
          <Badge variant="outline">{account.currency}</Badge>
          {account.kind === "liability" ? <Badge>{tk("liability")}</Badge> : null}
          {!account.includeInNetWorth ? <Badge>{t("excluded")}</Badge> : null}
          {archived ? (
            <Badge data-testid="account-archived">
              {account.closedOn
                ? t("archivedSince", { date: day(account.closedOn) })
                : t("archived")}
            </Badge>
          ) : null}
        </div>
        <span className="text-xs text-muted-foreground">
          {tt(account.accountType)} ·{" "}
          {latest
            ? t("latest", {
                amount: money(latest.amount, latest.currency),
                date: day(latest.valuationDate),
              })
            : t("noSnapshot")}
        </span>
      </div>
      <div className="flex items-center gap-0.5">
        <Link
          href={`/finance/accounts/${account.id}`}
          className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-muted hover:text-foreground"
          aria-label={t("history", { name: account.name })}
        >
          <History className="size-4" aria-hidden />
        </Link>
        {!archived ? (
          <>
            <IconButton
              label={t("moveUp", { name: account.name })}
              disabled={first}
              onClick={() => actions.moveAccount.mutate({ id: account.id, direction: "up" })}
            >
              <ArrowUp />
            </IconButton>
            <IconButton
              label={t("moveDown", { name: account.name })}
              disabled={last}
              onClick={() => actions.moveAccount.mutate({ id: account.id, direction: "down" })}
            >
              <ArrowDown />
            </IconButton>
          </>
        ) : null}
        <IconButton label={t("editAccountNamed", { name: account.name })} onClick={onEdit}>
          <Pencil />
        </IconButton>
        {archived ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => actions.archiveAccount.mutate({ id: account.id, archived: false })}
            data-testid="account-reactivate"
          >
            <ArchiveRestore aria-hidden />
            {t("reactivate")}
          </Button>
        ) : account.snapshotCount === 0 ? (
          <IconButton
            label={t("deleteAccount", { name: account.name })}
            onClick={() => onConfirm({ kind: "deleteAccount", account })}
          >
            <Trash2 />
          </IconButton>
        ) : (
          <IconButton
            label={t("archiveAccountTitle", { name: account.name })}
            onClick={() => onConfirm({ kind: "archiveAccount", account })}
            testId="account-archive"
          >
            <Archive />
          </IconButton>
        )}
      </div>
    </li>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  children,
  testId,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      data-testid={testId}
    >
      {children}
    </Button>
  );
}
