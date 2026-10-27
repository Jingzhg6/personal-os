import { protectedProcedure, router } from "@/shared/trpc/init";

import {
  accountHistoryInput,
  archiveAccountInput,
  archiveInput,
  batchDraftInput,
  createAccountInput,
  createProviderInput,
  historyInput,
  idInput,
  moveInput,
  saveBatchInput,
  updateAccountInput,
  updateProviderInput,
  updateSettingsInput,
} from "../domain";
import {
  getAccountHistory,
  getFinanceHistory,
  getFinanceOverview,
  getFinanceStructure,
} from "./read-model";
import { deleteSnapshot, getBatchDraft, saveBatch } from "./snapshots";
import {
  archiveAccount,
  createAccount,
  createProvider,
  deleteAccount,
  deleteProvider,
  moveAccount,
  moveProvider,
  reactivateAccount,
  setBaseCurrency,
  setProviderArchived,
  updateAccount,
  updateProvider,
} from "./structure";

/** Personal finance. Every procedure is scoped to the signed-in user (ids from the client are only looked up within it). */
export const financeRouter = router({
  overview: protectedProcedure.query(({ ctx }) => getFinanceOverview(ctx.db, ctx.userId)),
  history: protectedProcedure
    .input(historyInput)
    .query(({ ctx, input }) => getFinanceHistory(ctx.db, ctx.userId, input.range)),
  structure: protectedProcedure.query(({ ctx }) => getFinanceStructure(ctx.db, ctx.userId)),
  setBaseCurrency: protectedProcedure
    .input(updateSettingsInput)
    .mutation(({ ctx, input }) => setBaseCurrency(ctx.db, ctx.userId, input.baseCurrency)),
  providers: router({
    create: protectedProcedure
      .input(createProviderInput)
      .mutation(({ ctx, input }) => createProvider(ctx.db, ctx.userId, input)),
    update: protectedProcedure
      .input(updateProviderInput)
      .mutation(({ ctx, input }) => updateProvider(ctx.db, ctx.userId, input)),
    move: protectedProcedure
      .input(moveInput)
      .mutation(({ ctx, input }) => moveProvider(ctx.db, ctx.userId, input.id, input.direction)),
    setArchived: protectedProcedure
      .input(archiveInput)
      .mutation(({ ctx, input }) =>
        setProviderArchived(ctx.db, ctx.userId, input.id, input.archived),
      ),
    delete: protectedProcedure
      .input(idInput)
      .mutation(({ ctx, input }) => deleteProvider(ctx.db, ctx.userId, input.id)),
  }),
  accounts: router({
    history: protectedProcedure
      .input(accountHistoryInput)
      .query(({ ctx, input }) => getAccountHistory(ctx.db, ctx.userId, input.id)),
    create: protectedProcedure
      .input(createAccountInput)
      .mutation(({ ctx, input }) => createAccount(ctx.db, ctx.userId, input)),
    update: protectedProcedure
      .input(updateAccountInput)
      .mutation(({ ctx, input }) => updateAccount(ctx.db, ctx.userId, input)),
    move: protectedProcedure
      .input(moveInput)
      .mutation(({ ctx, input }) => moveAccount(ctx.db, ctx.userId, input.id, input.direction)),
    setArchived: protectedProcedure
      .input(archiveAccountInput)
      .mutation(({ ctx, input }) =>
        input.archived
          ? archiveAccount(ctx.db, ctx.userId, input.id, input.closedOn ?? null)
          : reactivateAccount(ctx.db, ctx.userId, input.id),
      ),
    delete: protectedProcedure
      .input(idInput)
      .mutation(({ ctx, input }) => deleteAccount(ctx.db, ctx.userId, input.id)),
  }),
  snapshots: router({
    draft: protectedProcedure
      .input(batchDraftInput)
      .query(({ ctx, input }) => getBatchDraft(ctx.db, ctx.userId, input.valuationDate)),
    saveBatch: protectedProcedure
      .input(saveBatchInput)
      .mutation(({ ctx, input }) => saveBatch(ctx, ctx.userId, input)),
    delete: protectedProcedure
      .input(idInput)
      .mutation(({ ctx, input }) => deleteSnapshot(ctx.db, ctx.userId, input.id)),
  }),
});
