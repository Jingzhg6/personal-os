"use client";

import { createAuthClient } from "better-auth/react";

/** Browser-side Better Auth client. Uses the same origin as the app. */
export const authClient = createAuthClient();
