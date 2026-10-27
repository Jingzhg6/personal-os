"use client";

import { ChevronLeft, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card, CardContent } from "@/shared/ui/card";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { PageHeader } from "@/shared/ui/page-header";

import type { Snapshot } from "../domain";
import { useDay, useMoney } from "./format";
import { useAccountHistory, useFinanceActions } from "./use-finance";

/**
 * One account's recorded balances, newest first: the original amount, the rate it was valued with
 * and the value at the time. Old rows are never revalued.
 */
export function AccountHistoryView({ id }: { id: string }) {
  const t = useTranslations("finance.history");
  const ta = useTranslations("finance.accounts");
  const tt = useTranslations("finance.accountTypes");
  const tk = useTranslations("finance.kinds");
  const money = useMoney();
  const day = useDay();
  const { data, isError } = useAccountHistory(id);
  const { deleteSnapshot } = useFinanceActions();
  const [removing, setRemoving] = useState<Snapshot | null>(null);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6" data-testid="account-history">
      <Link
        href="/finance/accounts"
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" aria-hidden />
        {t("back")}
      </Link>
      {isError ? (
        <Card>
          <CardContent
            className="py-10 text-center text-sm text-muted-foreground"
            data-testid="account-not-found"
          >
            {t("notFound")}
          </CardContent>
        </Card>
      ) : !data ? null : (
        <>
          <PageHeader
            title={data.account.name}
            description={
              <span className="flex flex-wrap items-center gap-1.5">
                {data.providerName} · {tt(data.account.accountType)}
                <Badge variant="outline">{data.account.currency}</Badge>
                {data.account.kind === "liability" ? <Badge>{tk("liability")}</Badge> : null}
                {data.account.archivedAt ? <Badge>{ta("archived")}</Badge> : null}
              </span>
            }
          />
          {data.account.kind === "liability" ? (
            <p className="text-sm text-muted-foreground">{t("liabilityNote")}</p>
          ) : null}
          <Card>
            <CardContent>
              {data.snapshots.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">{t("empty")}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table
                    className="w-full min-w-[34rem] text-sm"
                    data-testid="account-history-table"
                  >
                    <thead>
                      <tr className="border-b border-border text-left text-muted-foreground">
                        <th scope="col" className="py-2 pr-4 font-medium">
                          {t("date")}
                        </th>
                        <th scope="col" className="py-2 pr-4 text-right font-medium">
                          {t("amount", { currency: data.account.currency })}
                        </th>
                        <th scope="col" className="py-2 pr-4 text-right font-medium">
                          {t("rate")}
                        </th>
                        <th scope="col" className="py-2 pr-4 text-right font-medium">
                          {t("base", { base: data.baseCurrency })}
                        </th>
                        <th scope="col" className="py-2 pr-4 text-right font-medium">
                          {t("revision")}
                        </th>
                        <th scope="col" className="py-2">
                          <span className="sr-only">{t("edit")}</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.snapshots.map((s) => (
                        <tr
                          key={s.id}
                          className="border-b border-border/60 last:border-0"
                          data-testid="account-history-row"
                        >
                          <th
                            scope="row"
                            className="py-2 pr-4 text-left font-normal whitespace-nowrap"
                          >
                            {day(s.valuationDate)}
                          </th>
                          <td className="py-2 pr-4 text-right font-medium tabular-nums">
                            {money(s.amount, s.currency)}
                          </td>
                          <td className="py-2 pr-4 text-right text-muted-foreground tabular-nums">
                            {s.fxSource === "manual" ? s.fxRate : t("identity")}
                          </td>
                          <td className="py-2 pr-4 text-right tabular-nums">
                            {s.baseAmount !== null ? (
                              money(s.baseAmount, s.baseCurrency)
                            ) : (
                              <span className="text-warning">{t("unconverted")}</span>
                            )}
                          </td>
                          <td className="py-2 pr-4 text-right text-muted-foreground tabular-nums">
                            {s.revision}
                          </td>
                          <td className="py-2 text-right whitespace-nowrap">
                            {!data.account.archivedAt ? (
                              <Link
                                href={`/finance/snapshot?date=${s.valuationDate}`}
                                className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-muted hover:text-foreground"
                                aria-label={t("edit")}
                                title={t("edit")}
                              >
                                <Pencil className="size-4" aria-hidden />
                              </Link>
                            ) : null}
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={t("delete")}
                              title={t("delete")}
                              onClick={() => setRemoving(s)}
                            >
                              <Trash2 />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
      <ConfirmDialog
        open={removing !== null}
        title={removing ? t("deleteTitle", { date: day(removing.valuationDate) }) : ""}
        description={t("deleteBody")}
        confirmLabel={t("delete")}
        pending={deleteSnapshot.isPending}
        onCancel={() => setRemoving(null)}
        onConfirm={() =>
          removing &&
          deleteSnapshot.mutate({ id: removing.id }, { onSuccess: () => setRemoving(null) })
        }
      />
    </div>
  );
}
