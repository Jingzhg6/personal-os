import { getEnv } from "@/shared/config/env";
import { protectedProcedure, router, type TrpcContext } from "@/shared/trpc/init";

import { applyProposalInput, generateInput, historyInput, proposalIdInput } from "../domain";
import { generate, getAiStatus, type AdvisorDeps } from "./advisor";
import { buildReviewFacts } from "./context";
import {
  applyProposal,
  clearHistory,
  deleteProposal,
  discardProposal,
  expireProposals,
  getProposal,
  listProposals,
  markStaleProposals,
} from "./proposals";
import { providerFromEnv } from "./provider";

/** Provider and limits from the server environment, per request (nothing is cached client-side). */
function advisorDeps(ctx: TrpcContext): AdvisorDeps {
  const env = getEnv();
  return {
    db: ctx.db,
    provider: providerFromEnv(env),
    dailyLimit: env.AI_DAILY_LIMIT,
    perMinuteLimit: env.AI_PER_MINUTE_LIMIT,
    timeoutMs: env.AI_TIMEOUT_MS,
    schedulerConfigured: Boolean(env.AUTOMATION_WORKER_SECRET),
  };
}

/**
 * AI advisor. Every procedure requires a session and works on `ctx.userId` only; ids from the
 * client are always re-checked against that user. Generating never changes other modules' data;
 * `proposals.apply` (explicit confirmation) is the only path to a change.
 */
export const aiRouter = router({
  status: protectedProcedure.query(({ ctx }) => getAiStatus(advisorDeps(ctx), ctx.userId)),
  /** The review's facts — computed by the app, available even when AI is off. */
  reviewFacts: protectedProcedure.query(({ ctx }) =>
    buildReviewFacts(ctx.db, ctx.userId, {
      schedulerConfigured: Boolean(getEnv().AUTOMATION_WORKER_SECRET),
    }),
  ),
  generate: protectedProcedure
    .input(generateInput)
    .mutation(({ ctx, input }) => generate(advisorDeps(ctx), ctx.userId, input)),
  proposals: router({
    list: protectedProcedure.input(historyInput).query(async ({ ctx, input }) => {
      const now = new Date();
      await expireProposals(ctx.db, ctx.userId, now);
      await markStaleProposals(ctx.db, ctx.userId, now);
      return listProposals(ctx.db, ctx.userId, input.limit);
    }),
    byId: protectedProcedure
      .input(proposalIdInput)
      .query(({ ctx, input }) => getProposal(ctx.db, ctx.userId, input.id)),
    approve: protectedProcedure
      .input(applyProposalInput)
      .mutation(({ ctx, input }) => applyProposal(ctx, ctx.userId, input)),
    discard: protectedProcedure
      .input(proposalIdInput)
      .mutation(({ ctx, input }) => discardProposal(ctx.db, ctx.userId, input.id)),
    delete: protectedProcedure
      .input(proposalIdInput)
      .mutation(({ ctx, input }) => deleteProposal(ctx.db, ctx.userId, input.id)),
    clear: protectedProcedure.mutation(({ ctx }) => clearHistory(ctx.db, ctx.userId)),
  }),
});
