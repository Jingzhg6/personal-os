"use client";

import { useTranslations } from "next-intl";
import { useId, useState, type FormEvent } from "react";

import { Button } from "@/shared/ui/button";
import { Dialog } from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Select } from "@/shared/ui/select";

import {
  accountKinds,
  assetAccountTypes,
  assetCategories,
  commonCurrencies,
  defaultCategory,
  isCurrencyCode,
  liabilityAccountTypes,
  providerTypes,
  type AccountKind,
  type AccountType,
  type AssetCategory,
  type FinanceAccount,
  type FinanceProvider,
  type ProviderType,
} from "../domain";

const textareaClass =
  "w-full rounded-md border border-input bg-surface px-3 py-2 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30";

export interface ProviderFormValues {
  name: string;
  providerType: ProviderType;
  country: string | null;
  notes: string | null;
}

export function ProviderFormDialog({
  provider,
  pending,
  onClose,
  onSubmit,
}: {
  provider?: FinanceProvider;
  pending?: boolean;
  onClose: () => void;
  onSubmit: (values: ProviderFormValues) => void;
}) {
  const t = useTranslations("finance.accounts");
  const tp = useTranslations("finance.providerTypes");
  const ids = { name: useId(), type: useId(), country: useId(), notes: useId() };
  const [name, setName] = useState(provider?.name ?? "");
  const [providerType, setProviderType] = useState<ProviderType>(provider?.providerType ?? "bank");
  const [country, setCountry] = useState(provider?.country ?? "");
  const [notes, setNotes] = useState(provider?.notes ?? "");

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    onSubmit({
      name: name.trim(),
      providerType,
      country: country.trim() || null,
      notes: notes.trim() || null,
    });
  }

  return (
    <Dialog open onClose={onClose} title={provider ? t("editProvider") : t("newProvider")}>
      <form onSubmit={submit} className="flex flex-col gap-4" data-testid="provider-form">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={ids.name}>{t("providerName")}</Label>
          <Input
            id={ids.name}
            autoFocus
            value={name}
            maxLength={80}
            placeholder={t("providerNamePlaceholder")}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={ids.type}>{t("providerType")}</Label>
            <Select
              id={ids.type}
              value={providerType}
              onChange={(event) => setProviderType(event.target.value as ProviderType)}
            >
              {providerTypes.map((type) => (
                <option key={type} value={type}>
                  {tp(type)}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={ids.country}>{t("country")}</Label>
            <Input
              id={ids.country}
              value={country}
              maxLength={60}
              onChange={(event) => setCountry(event.target.value)}
            />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={ids.notes}>{t("notes")}</Label>
          <textarea
            id={ids.notes}
            rows={2}
            maxLength={500}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            className={textareaClass}
          />
        </div>
        <div className="flex justify-end">
          <Button type="submit" disabled={pending || !name.trim()}>
            {provider ? t("save") : t("create")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export interface AccountFormValues {
  name: string;
  kind: AccountKind;
  accountType: AccountType;
  assetCategory: AssetCategory | null;
  currency: string;
  includeInNetWorth: boolean;
  notes: string | null;
}

/**
 * Create / edit an account. Once an account has balance history its currency and its kind are
 * fixed (the server enforces this too): history in one currency never silently becomes another.
 */
export function AccountFormDialog({
  account,
  baseCurrency,
  pending,
  onClose,
  onSubmit,
}: {
  account?: FinanceAccount;
  baseCurrency: string;
  pending?: boolean;
  onClose: () => void;
  onSubmit: (values: AccountFormValues) => void;
}) {
  const t = useTranslations("finance.accounts");
  const tk = useTranslations("finance.kinds");
  const tt = useTranslations("finance.accountTypes");
  const tc = useTranslations("finance.categories");
  const ids = {
    name: useId(),
    kind: useId(),
    type: useId(),
    category: useId(),
    currency: useId(),
    include: useId(),
    notes: useId(),
  };
  const locked = (account?.snapshotCount ?? 0) > 0;
  const [name, setName] = useState(account?.name ?? "");
  const [kind, setKind] = useState<AccountKind>(account?.kind ?? "asset");
  const [accountType, setAccountType] = useState<AccountType>(account?.accountType ?? "current");
  const [category, setCategory] = useState<AssetCategory>(account?.assetCategory ?? "bank_deposit");
  const [currency, setCurrency] = useState(account?.currency ?? baseCurrency);
  const [include, setInclude] = useState(account?.includeInNetWorth ?? true);
  const [notes, setNotes] = useState(account?.notes ?? "");

  const types: readonly AccountType[] =
    kind === "asset" ? assetAccountTypes : liabilityAccountTypes;
  const code = currency.trim().toUpperCase();
  const currencyValid = isCurrencyCode(code);
  const valid = name.trim() !== "" && currencyValid;

  function changeKind(next: AccountKind) {
    setKind(next);
    const nextType = next === "asset" ? "current" : "credit_card";
    setAccountType(nextType);
    if (next === "asset") setCategory(defaultCategory(nextType));
  }

  function changeType(next: AccountType) {
    setAccountType(next);
    if (kind === "asset") setCategory(defaultCategory(next));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid) return;
    onSubmit({
      name: name.trim(),
      kind,
      accountType,
      assetCategory: kind === "asset" ? category : null,
      currency: code,
      includeInNetWorth: include,
      notes: notes.trim() || null,
    });
  }

  return (
    <Dialog open onClose={onClose} title={account ? t("editAccount") : t("newAccount")}>
      <form onSubmit={submit} className="flex flex-col gap-4" data-testid="account-form">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={ids.name}>{t("accountName")}</Label>
          <Input
            id={ids.name}
            autoFocus
            value={name}
            maxLength={80}
            placeholder={t("accountNamePlaceholder")}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={ids.kind}>{t("kind")}</Label>
            <Select
              id={ids.kind}
              value={kind}
              disabled={locked}
              onChange={(event) => changeKind(event.target.value as AccountKind)}
            >
              {accountKinds.map((k) => (
                <option key={k} value={k}>
                  {tk(k)}
                </option>
              ))}
            </Select>
            {locked ? (
              <span className="text-xs text-muted-foreground">{t("kindLocked")}</span>
            ) : null}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={ids.type}>{t("accountType")}</Label>
            <Select
              id={ids.type}
              value={accountType}
              onChange={(event) => changeType(event.target.value as AccountType)}
            >
              {types.map((type) => (
                <option key={type} value={type}>
                  {tt(type)}
                </option>
              ))}
            </Select>
          </div>
          {kind === "asset" ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={ids.category}>{t("category")}</Label>
              <Select
                id={ids.category}
                value={category}
                onChange={(event) => setCategory(event.target.value as AssetCategory)}
              >
                {assetCategories.map((c) => (
                  <option key={c} value={c}>
                    {tc(c)}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={ids.currency}>{t("currency")}</Label>
            <Input
              id={ids.currency}
              value={currency}
              maxLength={3}
              list={`${ids.currency}-list`}
              disabled={locked}
              aria-invalid={!currencyValid}
              className="uppercase"
              onChange={(event) => setCurrency(event.target.value)}
            />
            <datalist id={`${ids.currency}-list`}>
              {commonCurrencies.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            <span className="text-xs text-muted-foreground">
              {locked ? t("currencyLocked") : t("currencyHint")}
            </span>
          </div>
        </div>
        <label htmlFor={ids.include} className="flex items-center gap-2 text-sm">
          <input
            id={ids.include}
            type="checkbox"
            checked={include}
            onChange={(event) => setInclude(event.target.checked)}
            className="size-4 accent-primary"
          />
          {t("include")}
        </label>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={ids.notes}>{t("notes")}</Label>
          <textarea
            id={ids.notes}
            rows={2}
            maxLength={500}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            className={textareaClass}
          />
        </div>
        <div className="flex justify-end">
          <Button type="submit" disabled={pending || !valid}>
            {account ? t("save") : t("create")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
