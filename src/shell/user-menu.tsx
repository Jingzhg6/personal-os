"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { authClient } from "@/shared/auth/client";
import { Button } from "@/shared/ui/button";

export interface ShellUser {
  name: string;
  email: string;
}

export function UserMenu({ user }: { user: ShellUser }) {
  const t = useTranslations("shell.account");
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function signOut() {
    setPending(true);
    await authClient.signOut();
    router.replace("/login");
    router.refresh();
  }

  const initial = user.name.trim().charAt(0).toUpperCase() || "?";

  return (
    <div className="flex items-center gap-3 rounded-md px-2 py-2">
      <div
        aria-hidden
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-semibold text-accent-foreground"
      >
        {initial}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground" data-testid="current-user-name">
          {user.name}
        </p>
        <p className="truncate text-xs text-muted-foreground">{user.email}</p>
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={signOut}
        disabled={pending}
        aria-label={pending ? t("signingOut") : t("signOut")}
        title={t("signOut")}
      >
        <LogOut />
      </Button>
    </div>
  );
}
