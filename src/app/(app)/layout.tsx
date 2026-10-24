import type { ReactNode } from "react";

import { requireUser } from "@/server/session";
import { AppShell } from "@/shell/app-shell";

/** Every route in this group requires a signed-in user. */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  return <AppShell user={{ name: user.name, email: user.email }}>{children}</AppShell>;
}
