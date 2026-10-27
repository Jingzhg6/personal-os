import { protectedProcedure, router } from "@/shared/trpc/init";

import { updateUserSettingsInput } from "../domain";
import { getUserSettings, updateUserSettings } from "./repository";

export const settingsRouter = router({
  get: protectedProcedure.query(({ ctx }) => getUserSettings(ctx.db, ctx.userId)),
  update: protectedProcedure
    .input(updateUserSettingsInput)
    .mutation(({ ctx, input }) => updateUserSettings(ctx.db, ctx.userId, input)),
});
