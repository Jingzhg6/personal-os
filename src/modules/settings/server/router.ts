import { protectedProcedure, router } from "@/shared/trpc/init";

import { updateProfileInput, updateUserSettingsInput } from "../domain";
import { getUserSettings, updateProfile, updateUserSettings } from "./repository";

export const settingsRouter = router({
  get: protectedProcedure.query(({ ctx }) => getUserSettings(ctx.db, ctx.userId)),
  update: protectedProcedure
    .input(updateUserSettingsInput)
    .mutation(({ ctx, input }) => updateUserSettings(ctx.db, ctx.userId, input)),
  updateProfile: protectedProcedure
    .input(updateProfileInput)
    .mutation(({ ctx, input }) => updateProfile(ctx.db, ctx.userId, input)),
});
