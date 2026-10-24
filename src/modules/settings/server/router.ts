import { LOCALE_COOKIE } from "@/shared/i18n/config";
import { protectedProcedure, router } from "@/shared/trpc/init";

import { updateUserSettingsInput } from "../domain";
import { getUserSettings, updateUserSettings } from "./repository";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export const settingsRouter = router({
  get: protectedProcedure.query(({ ctx }) => getUserSettings(ctx.db, ctx.userId)),

  update: protectedProcedure.input(updateUserSettingsInput).mutation(async ({ ctx, input }) => {
    const settings = await updateUserSettings(ctx.db, ctx.userId, input);
    if (input.locale) {
      // Keeps the chosen language on signed-out pages (login) as well.
      ctx.resHeaders?.append(
        "Set-Cookie",
        `${LOCALE_COOKIE}=${input.locale}; Path=/; Max-Age=${ONE_YEAR_SECONDS}; SameSite=Lax`,
      );
    }
    return settings;
  }),
});
