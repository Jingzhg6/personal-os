import { z } from "zod";

import { protectedProcedure, router } from "@/shared/trpc/init";

import {
  claimLevelRewardInput,
  createLevelRewardInput,
  createRewardInput,
  redeemRewardInput,
  updateLevelRewardInput,
  updateRewardInput,
} from "../domain";
import { getBalances } from "./balances";
import {
  claimLevelReward,
  createLevelReward,
  deleteLevelReward,
  listLevelRewards,
  updateLevelReward,
} from "./level-rewards";
import {
  createReward,
  deleteReward,
  listRewardHistory,
  listRewards,
  redeemReward,
  updateReward,
} from "./store";

const idInput = z.object({ id: z.uuid() });

export const rewardsRouter = router({
  /** Lifetime and spendable Active / Level XP. */
  balances: protectedProcedure.query(({ ctx }) => getBalances(ctx.db, ctx.userId)),
  list: protectedProcedure.query(({ ctx }) => listRewards(ctx.db, ctx.userId)),
  create: protectedProcedure
    .input(createRewardInput)
    .mutation(({ ctx, input }) => createReward(ctx.db, ctx.userId, input)),
  update: protectedProcedure
    .input(updateRewardInput)
    .mutation(({ ctx, input }) => updateReward(ctx.db, ctx.userId, input)),
  delete: protectedProcedure
    .input(idInput)
    .mutation(({ ctx, input }) => deleteReward(ctx.db, ctx.userId, input.id)),
  redeem: protectedProcedure
    .input(redeemRewardInput)
    .mutation(({ ctx, input }) => redeemReward(ctx.db, ctx.userId, input)),
  history: protectedProcedure.query(({ ctx }) => listRewardHistory(ctx.db, ctx.userId)),
  levelRewards: router({
    list: protectedProcedure.query(({ ctx }) => listLevelRewards(ctx.db, ctx.userId)),
    create: protectedProcedure
      .input(createLevelRewardInput)
      .mutation(({ ctx, input }) => createLevelReward(ctx.db, ctx.userId, input)),
    update: protectedProcedure
      .input(updateLevelRewardInput)
      .mutation(({ ctx, input }) => updateLevelReward(ctx.db, ctx.userId, input)),
    delete: protectedProcedure
      .input(idInput)
      .mutation(({ ctx, input }) => deleteLevelReward(ctx.db, ctx.userId, input.id)),
    claim: protectedProcedure
      .input(claimLevelRewardInput)
      .mutation(({ ctx, input }) => claimLevelReward(ctx.db, ctx.userId, input)),
  }),
});
