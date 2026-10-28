import type { ReactNode } from "react";

import { getUserSettings } from "@/modules/settings/server";
import { PreferencesProvider } from "@/modules/settings/ui";
import { requireUser } from "@/server/session";
import { getDb } from "@/shared/db/client";
import { AppShell } from "@/shell/app-shell";

/** Every route in this group requires a signed-in user. */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const settings = await getUserSettings(getDb(), user.id);
  return (
    <PreferencesProvider weekStartsOn={settings.weekStartsOn}>
      <AppShell user={{ name: user.name, email: user.email }}>{children}</AppShell>
    </PreferencesProvider>
  );
}
