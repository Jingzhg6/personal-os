import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { getAuth } from "./auth";

/** Current session, or null. Deduplicated per request. */
export const getSession = cache(async () => {
  // Headers first: it marks the page as per-request, so a build never needs the runtime
  // environment (secrets, database URL) that getAuth() reads.
  const requestHeaders = await headers();
  return getAuth().api.getSession({ headers: requestHeaders });
});

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
}

/** Returns the signed-in user or redirects to the login page. */
export async function requireUser(): Promise<CurrentUser> {
  const session = await getSession();
  if (!session) redirect("/login");
  const { id, name, email } = session.user;
  return { id, name, email };
}
