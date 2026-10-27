import { redirect } from "next/navigation";

/** The dashboard moved to `/` in M7; old links and bookmarks keep working. */
export default function LegacyDashboard() {
  redirect("/");
}
