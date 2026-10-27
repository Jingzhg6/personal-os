"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useId, useState } from "react";

import { REWARD_XP_RATES } from "@/modules/character/domain";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { Dialog } from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { useToast } from "@/shared/ui/toast";

import {
  calculateRewardPurchase,
  paymentStrategies,
  type Payment,
  type PaymentStrategy,
  type Reward,
  type XpBalances,
} from "../domain";
import { useRewardMutations } from "./use-rewards";

/**
 * Choose how to pay. The preview uses the same calculation as the server; the server recomputes
 * it with fresh balances inside the redemption transaction and decides the final amounts.
 */
export function RedeemDialog({
  reward,
  balances,
  onClose,
}: {
  reward: Reward;
  balances: XpBalances;
  onClose: () => void;
}) {
  const t = useTranslations("rewards.redeem");
  const format = useFormatter();
  const toast = useToast();
  const ts = useTranslations("rewards.store");
  const tc = useTranslations("common");
  const id = useId();
  const mutations = useRewardMutations();
  // One key per attempt: retries of the same click never spend twice.
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [strategy, setStrategy] = useState<PaymentStrategy>(
    reward.payWithActive ? "active_first" : "level_first",
  );
  const initial = calculateRewardPurchase(reward, balances, { strategy: "active_first" });
  const [custom, setCustom] = useState({
    activeXp: initial.activeXpToSpend,
    levelXp: initial.levelXpToSpend,
  });

  const payment: Payment = strategy === "custom" ? { strategy, ...custom } : { strategy };
  const purchase = calculateRewardPurchase(reward, balances, payment);
  const problem = purchase.problem;

  return (
    <Dialog open onClose={onClose} title={t("title", { name: reward.name })}>
      <div className="flex flex-col gap-4" data-testid="redeem-dialog">
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-sm font-medium">{t("strategy")}</legend>
          <div
            role="radiogroup"
            className="inline-flex flex-wrap gap-1 rounded-md border border-border p-0.5"
          >
            {paymentStrategies.map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={strategy === option}
                onClick={() => setStrategy(option)}
                className={cn(
                  "rounded px-3 py-1 text-sm",
                  strategy === option
                    ? "bg-accent font-medium text-accent-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t(option)}
              </button>
            ))}
          </div>
        </fieldset>

        {strategy === "custom" ? (
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-active`}>{t("activeXp")}</Label>
              <Input
                id={`${id}-active`}
                type="number"
                min={0}
                disabled={!reward.payWithActive}
                value={custom.activeXp}
                onChange={(event) =>
                  setCustom((c) => ({ ...c, activeXp: Math.max(0, Number(event.target.value)) }))
                }
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-level`}>{t("levelXp")}</Label>
              <Input
                id={`${id}-level`}
                type="number"
                min={0}
                disabled={!reward.payWithLevel}
                value={custom.levelXp}
                onChange={(event) =>
                  setCustom((c) => ({ ...c, levelXp: Math.max(0, Number(event.target.value)) }))
                }
              />
            </div>
          </div>
        ) : null}

        <div
          className="flex flex-col gap-1 rounded-md bg-surface-muted p-3 text-sm tabular-nums"
          data-testid="redeem-preview"
        >
          <span>
            {t("pay", {
              active: format.number(purchase.activeXpToSpend),
              level: format.number(purchase.levelXpToSpend),
            })}
          </span>
          <span
            className={cn(
              purchase.purchaseValue >= reward.value ? "text-foreground" : "text-danger",
            )}
          >
            {t("power", {
              value: format.number(purchase.purchaseValue),
              price: format.number(reward.value),
            })}
            <span className="ml-1 text-xs text-muted-foreground">
              {`(1 : ${REWARD_XP_RATES.level})`}
            </span>
          </span>
          {problem ? (
            <span role="alert" className="text-danger">
              {t(`problems.${problem}`, { missing: purchase.remainingPurchaseValue })}
            </span>
          ) : (
            <span className="text-muted-foreground">
              {t("after", {
                active: format.number(balances.spendableActiveXp - purchase.activeXpToSpend),
                level: format.number(balances.spendableLevelXp - purchase.levelXpToSpend),
              })}
            </span>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {tc("cancel")}
          </Button>
          <Button
            disabled={!purchase.canRedeem || mutations.redeem.isPending}
            onClick={() =>
              mutations.redeem.mutate(
                { rewardId: reward.id, payment, idempotencyKey },
                {
                  onSuccess: () => {
                    toast.show(ts("redeemed", { name: reward.name }));
                    onClose();
                  },
                },
              )
            }
          >
            {t("confirm")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
