"use client";

import { Gift, Lock, Pencil, Plus, Shield, Trash2, Zap } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useState, type FormEvent, type ReactNode } from "react";

import { REWARD_XP_RATES } from "@/modules/character/domain";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardDescription } from "@/shared/ui/card";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { Input } from "@/shared/ui/input";
import { PageHeader } from "@/shared/ui/page-header";
import { useToast } from "@/shared/ui/toast";

import { firstEarlyClaimLevel, type LevelReward, type Reward, type XpBalances } from "../domain";
import { RedeemDialog } from "./redeem-dialog";
import { RewardFormDialog, type RewardFormValues } from "./reward-form-dialog";
import {
  useBalances,
  useEntryTitle,
  useLevelRewardLabel,
  useLevelRewards,
  useRewardHistory,
  useRewardMutations,
  useRewards,
} from "./use-rewards";

const tabs = ["store", "level", "history"] as const;
const SHORT_DATE = { month: "short", day: "numeric" } as const;
type Tab = (typeof tabs)[number];

/**
 * Spending XP on real-world rewards: the store, level rewards and the redemption history.
 * Everything here lowers spendable balances only — lifetime XP and the level never change.
 */
export function RewardsView({ title }: { title: string }) {
  const t = useTranslations("rewards");
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tab: Tab = tabs.find((x) => x === searchParams.get("tab")) ?? "store";
  const { data: balances } = useBalances();
  const [creating, setCreating] = useState(false);
  const mutations = useRewardMutations();
  const toast = useToast();

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <PageHeader
        title={title}
        description={t("description")}
        actions={
          tab === "store" ? (
            <Button onClick={() => setCreating(true)}>
              <Plus />
              {t("store.new")}
            </Button>
          ) : null
        }
      />

      {balances ? <BalanceBar balances={balances} /> : null}

      <nav
        aria-label={t("tabs.label")}
        className="flex gap-1 overflow-x-auto border-b border-border"
      >
        {tabs.map((key) => (
          <Link
            key={key}
            href={key === "store" ? pathname : `${pathname}?tab=${key}`}
            scroll={false}
            aria-current={tab === key ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm whitespace-nowrap transition-colors",
              tab === key
                ? "border-primary font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t(`tabs.${key}`)}
          </Link>
        ))}
      </nav>

      {!balances ? null : tab === "store" ? (
        <Store balances={balances} />
      ) : tab === "level" ? (
        <LevelRewards balances={balances} />
      ) : (
        <History />
      )}

      {creating ? (
        <RewardFormDialog
          pending={mutations.create.isPending}
          onClose={() => setCreating(false)}
          onSubmit={(values) =>
            mutations.create.mutate(values, {
              onSuccess: () => {
                setCreating(false);
                toast.show(t("form.created"));
              },
            })
          }
        />
      ) : null}
    </div>
  );
}

function BalanceBar({ balances }: { balances: XpBalances }) {
  const t = useTranslations("rewards.balances");
  return (
    <div className="flex flex-col gap-2">
      <div className="grid gap-4 sm:grid-cols-2">
        <BalanceItem
          testId="balance-active"
          icon={<Zap className="size-5" aria-hidden />}
          label={t("active")}
          spendable={balances.spendableActiveXp}
          lifetime={balances.lifetimeActiveXp}
        />
        <BalanceItem
          testId="balance-level"
          icon={<Shield className="size-5" aria-hidden />}
          label={t("level")}
          spendable={balances.spendableLevelXp}
          lifetime={balances.lifetimeLevelXp}
        />
      </div>
      <p className="text-xs text-muted-foreground">{t("rate", { rate: REWARD_XP_RATES.level })}</p>
    </div>
  );
}

function BalanceItem({
  testId,
  icon,
  label,
  spendable,
  lifetime,
}: {
  testId: string;
  icon: ReactNode;
  label: string;
  spendable: number;
  lifetime: number;
}) {
  const t = useTranslations("rewards.balances");
  const format = useFormatter();
  return (
    <Card data-testid={testId}>
      <CardContent className="flex items-center gap-4">
        <span className="flex size-10 items-center justify-center rounded-xl bg-primary/12 text-primary">
          {icon}
        </span>
        <div className="flex flex-col">
          <span className="text-xs text-muted-foreground">{label}</span>
          <span className="text-2xl font-semibold tabular-nums" data-testid={`${testId}-spendable`}>
            {format.number(spendable)}
          </span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {t("lifetime", { xp: format.number(lifetime) })}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function Store({ balances }: { balances: XpBalances }) {
  const t = useTranslations("rewards");
  const { data: rewards = [] } = useRewards();
  const [redeeming, setRedeeming] = useState<Reward | null>(null);
  const [editing, setEditing] = useState<Reward | null>(null);
  const [deleting, setDeleting] = useState<Reward | null>(null);
  const mutations = useRewardMutations();
  const toast = useToast();
  const tc = useTranslations("common");

  if (rewards.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-6 py-14 text-center">
        <Gift className="size-8 text-muted-foreground/60" aria-hidden />
        <p className="text-sm text-muted-foreground">{t("store.empty")}</p>
      </div>
    );
  }

  return (
    <>
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label={t("tabs.store")}>
        {rewards.map((reward) => (
          <RewardCard
            key={reward.id}
            reward={reward}
            onRedeem={() => setRedeeming(reward)}
            onEdit={() => setEditing(reward)}
          />
        ))}
      </ul>
      {redeeming ? (
        <RedeemDialog reward={redeeming} balances={balances} onClose={() => setRedeeming(null)} />
      ) : null}
      {editing ? (
        <RewardFormDialog
          reward={editing}
          pending={mutations.update.isPending}
          onClose={() => setEditing(null)}
          onDelete={editing.redemptionCount === 0 ? () => setDeleting(editing) : undefined}
          onSubmit={(values: RewardFormValues) =>
            mutations.update.mutate(
              { id: editing.id, patch: values },
              {
                onSuccess: () => {
                  setEditing(null);
                  toast.show(t("form.saved"));
                },
              },
            )
          }
        />
      ) : null}
      <ConfirmDialog
        open={deleting !== null}
        title={t("form.deleteTitle", { name: deleting?.name ?? "" })}
        description={t("form.deleteBody")}
        confirmLabel={tc("delete")}
        pending={mutations.remove.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() =>
          deleting &&
          mutations.remove.mutate(
            { id: deleting.id },
            {
              onSuccess: () => {
                setDeleting(null);
                setEditing(null);
                toast.show(t("form.deleted"));
              },
            },
          )
        }
      />
    </>
  );
}

function RewardCard({
  reward,
  onRedeem,
  onEdit,
}: {
  reward: Reward;
  onRedeem: () => void;
  onEdit: () => void;
}) {
  const t = useTranslations("rewards");
  const format = useFormatter();
  const soldOut = reward.remaining === 0;
  return (
    <li data-testid="reward-card" className={cn(!reward.enabled && "opacity-60")}>
      <Card className="flex h-full flex-col">
        <CardContent className="flex flex-1 flex-col gap-3">
          <div className="flex items-start gap-3">
            <span
              className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-surface-muted text-2xl"
              aria-hidden
            >
              {reward.emoji ?? "🎁"}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate font-medium">{reward.name}</span>
              <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                <span className="rounded bg-surface-muted px-1.5 py-0.5">
                  {t(`categories.${reward.category}`)}
                </span>
                {!reward.enabled ? <span>{t("store.disabled")}</span> : null}
                {soldOut ? (
                  <span>{t("store.soldOut")}</span>
                ) : reward.remaining !== null ? (
                  <span>
                    {reward.repeatable
                      ? t("store.remaining", { count: reward.remaining })
                      : t("store.once")}
                  </span>
                ) : null}
              </span>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onEdit}
              aria-label={`${t("store.edit")}「${reward.name}」`}
            >
              <Pencil />
            </Button>
          </div>
          {reward.description ? (
            <CardDescription className="line-clamp-2">{reward.description}</CardDescription>
          ) : null}
          <div className="mt-auto flex flex-col gap-1 text-sm tabular-nums">
            <span className="text-xs text-muted-foreground">
              {t("store.value", { value: format.number(reward.value) })}
              {reward.realWorldCostCents !== null
                ? ` · ${t("store.realCost", { cost: format.number(reward.realWorldCostCents / 100) })}`
                : ""}
            </span>
            <span className="flex flex-wrap items-center gap-x-2 font-medium">
              {reward.payWithActive ? (
                <span className="inline-flex items-center gap-1">
                  <Zap className="size-3.5 text-amber-500" aria-hidden />
                  {t("store.costActive", { xp: format.number(reward.activeXpCost) })}
                </span>
              ) : null}
              {reward.payWithActive && reward.payWithLevel ? (
                <span className="text-xs font-normal text-muted-foreground">{t("store.or")}</span>
              ) : null}
              {reward.payWithLevel ? (
                <span className="inline-flex items-center gap-1">
                  <Shield className="size-3.5 text-primary" aria-hidden />
                  {t("store.costLevel", { xp: format.number(reward.levelXpCost) })}
                </span>
              ) : null}
            </span>
          </div>
          <Button
            className="w-full"
            disabled={!reward.enabled || soldOut}
            onClick={onRedeem}
            aria-label={`${t("store.redeem")}「${reward.name}」`}
          >
            {t("store.redeem")}
          </Button>
        </CardContent>
      </Card>
    </li>
  );
}

function LevelRewards({ balances }: { balances: XpBalances }) {
  const t = useTranslations("rewards.level");
  const { data: rewards = [] } = useLevelRewards();
  const label = useLevelRewardLabel();
  const mutations = useRewardMutations();
  const toast = useToast();
  const format = useFormatter();
  const [confirming, setConfirming] = useState<LevelReward | null>(null);
  const [newLevel, setNewLevel] = useState("");
  const [newName, setNewName] = useState("");
  const [newEmoji, setNewEmoji] = useState("");
  const tf = useTranslations("rewards.form");

  const claim = (reward: LevelReward) =>
    mutations.claimLevel.mutate(
      { levelRewardId: reward.id, idempotencyKey: crypto.randomUUID() },
      {
        onSuccess: () => {
          setConfirming(null);
          toast.show(t("claimedToast", { name: label(reward) }));
        },
      },
    );

  function add(event: FormEvent) {
    event.preventDefault();
    const level = Number(newLevel);
    if (!newName.trim() || !Number.isInteger(level) || level < 2) return;
    mutations.createLevel.mutate(
      { level, name: newName.trim(), emoji: newEmoji.trim() || null },
      {
        onSuccess: () => {
          setNewLevel("");
          setNewName("");
          setNewEmoji("");
          toast.show(t("saved"));
        },
      },
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        <span className="mr-2 font-medium text-foreground">
          {t("current", { level: balances.level })}
        </span>
        {t("description")}
      </p>
      <ul
        className="divide-y divide-border rounded-lg border border-border bg-surface"
        aria-label={t("current", { level: balances.level })}
      >
        {rewards.map((reward) => {
          const insufficient = (reward.earlyClaimCost ?? 0) > balances.spendableLevelXp;
          return (
            <li
              key={reward.id}
              data-testid="level-reward"
              data-state={reward.state}
              className="flex flex-wrap items-center gap-3 p-4"
            >
              <span className="w-14 shrink-0 rounded-md bg-primary/12 px-2 py-1 text-center text-sm font-semibold text-primary tabular-nums">
                {t("reachAt", { level: reward.level })}
              </span>
              <span className="text-2xl" aria-hidden>
                {reward.emoji ?? "🎁"}
              </span>
              <span className="min-w-0 flex-1 truncate font-medium">{label(reward)}</span>
              {reward.state === "claimed" ? (
                <span className="text-sm text-muted-foreground">
                  {reward.claim?.early
                    ? t("claimedEarly", { xp: format.number(reward.claim.levelXpSpent) })
                    : t("claimed")}
                </span>
              ) : reward.state === "claimable" ? (
                <Button
                  size="sm"
                  onClick={() => claim(reward)}
                  disabled={mutations.claimLevel.isPending}
                >
                  {t("claim")}
                </Button>
              ) : reward.state === "early" ? (
                <div className="flex flex-col items-end gap-0.5">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={insufficient}
                    onClick={() => setConfirming(reward)}
                  >
                    {t("earlyClaim", { cost: format.number(reward.earlyClaimCost ?? 0) })}
                  </Button>
                  {insufficient ? (
                    <span className="text-xs text-danger">{t("insufficient")}</span>
                  ) : null}
                </div>
              ) : (
                <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                  <Lock className="size-3.5" aria-hidden />
                  {t("locked", { level: firstEarlyClaimLevel(reward.level) })}
                </span>
              )}
              {reward.state !== "claimed" ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`${t("delete")}「${label(reward)}」`}
                  onClick={() => mutations.removeLevel.mutate({ id: reward.id })}
                >
                  <Trash2 />
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
      <form onSubmit={add} className="flex flex-wrap gap-2">
        <Input
          type="number"
          min={2}
          value={newLevel}
          onChange={(event) => setNewLevel(event.target.value)}
          placeholder={t("levelInput")}
          aria-label={t("levelInput")}
          className="w-24"
        />
        <Input
          value={newEmoji}
          onChange={(event) => setNewEmoji(event.target.value)}
          placeholder="🎁"
          aria-label={tf("emoji")}
          maxLength={8}
          className="w-16 text-center"
        />
        <Input
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          placeholder={tf("namePlaceholder")}
          aria-label={tf("name")}
          maxLength={60}
          className="min-w-40 flex-1"
        />
        <Button type="submit" disabled={!newName.trim() || !newLevel}>
          <Plus />
          {t("add")}
        </Button>
      </form>
      <ConfirmDialog
        open={confirming !== null}
        title={t("earlyTitle", { name: confirming ? label(confirming) : "" })}
        description={t("earlyBody", {
          cost: format.number(confirming?.earlyClaimCost ?? 0),
          level: confirming?.level ?? 0,
        })}
        confirmLabel={t("earlyConfirm")}
        tone="primary"
        pending={mutations.claimLevel.isPending}
        onCancel={() => setConfirming(null)}
        onConfirm={() => confirming && claim(confirming)}
      />
    </div>
  );
}

function History() {
  const t = useTranslations("rewards.history");
  const { data: entries = [] } = useRewardHistory();
  const title = useEntryTitle();
  const format = useFormatter();
  if (entries.length === 0) {
    return <p className="py-10 text-center text-sm text-muted-foreground">{t("empty")}</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">{t("note")}</p>
      <ul
        className="divide-y divide-border rounded-lg border border-border bg-surface"
        aria-label={t("redeemed")}
      >
        {entries.map((entry) => (
          <li
            key={entry.id}
            data-testid="reward-history-entry"
            className="flex flex-wrap items-center gap-3 p-4"
          >
            <time
              className="w-24 shrink-0 text-xs text-muted-foreground tabular-nums"
              dateTime={entry.createdAt.toISOString()}
            >
              {format.dateTime(entry.createdAt, SHORT_DATE)}
            </time>
            <span className="text-xl" aria-hidden>
              {entry.emoji ?? "🎁"}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-medium">{title(entry)}</span>
              <span className="text-xs text-muted-foreground">
                {entry.kind === "milestone_reward_claimed"
                  ? entry.early
                    ? t("claimedEarly")
                    : t("claimed")
                  : entry.kind === "reward_refunded"
                    ? t("refunded")
                    : t("redeemed")}
              </span>
            </span>
            <span className="flex flex-col items-end text-sm tabular-nums">
              {entry.activeXpSpent === 0 && entry.levelXpSpent === 0 ? (
                <span className="text-muted-foreground">{t("free")}</span>
              ) : null}
              {entry.activeXpSpent !== 0 ? (
                <span>{t("spentActive", { xp: format.number(entry.activeXpSpent) })}</span>
              ) : null}
              {entry.levelXpSpent !== 0 ? (
                <span className="text-primary">
                  {t("spentLevel", { xp: format.number(entry.levelXpSpent) })}
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
