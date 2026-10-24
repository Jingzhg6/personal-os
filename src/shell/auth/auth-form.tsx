"use client";

import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useState, type FormEvent } from "react";

import { authClient } from "@/shared/auth/client";
import type { Messages } from "@/shared/i18n/messages";
import { useTRPC } from "@/shared/trpc/react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";

type Mode = "login" | "register";

/** Only allow same-site relative redirects after login. */
function safeNext(value: string | null): string {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/dashboard";
}

export function AuthForm({ mode }: { mode: Mode }) {
  const t = useTranslations("auth");
  const router = useRouter();
  const searchParams = useSearchParams();
  const trpc = useTRPC();
  const updateSettings = useMutation(trpc.settings.update.mutationOptions());
  const ids = { name: useId(), email: useId(), password: useId() };

  const [pending, setPending] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");

    setPending(true);
    setErrorCode(null);

    const { error } =
      mode === "login"
        ? await authClient.signIn.email({ email, password })
        : await authClient.signUp.email({ email, password, name: String(form.get("name") ?? "") });

    if (error) {
      setErrorCode(error.status === 429 ? "TOO_MANY_REQUESTS" : (error.code ?? "generic"));
      setPending(false);
      return;
    }

    if (mode === "register") {
      // Remember the browser's timezone so "today" means the user's today.
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      await updateSettings.mutateAsync({ timeZone }).catch(() => undefined);
    }

    router.replace(safeNext(searchParams.get("next")));
    router.refresh();
  }

  // Better Auth error codes map 1:1 to keys in auth.errors; unknown codes use the generic message.
  type ErrorKey = `errors.${keyof Messages["auth"]["errors"]}`;
  const errorKey: ErrorKey =
    errorCode && t.has(`errors.${errorCode}` as ErrorKey)
      ? (`errors.${errorCode}` as ErrorKey)
      : "errors.generic";

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      {mode === "register" ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={ids.name}>{t("name")}</Label>
          <Input
            id={ids.name}
            name="name"
            autoComplete="name"
            placeholder={t("namePlaceholder")}
            required
          />
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={ids.email}>{t("email")}</Label>
        <Input id={ids.email} name="email" type="email" autoComplete="email" required />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={ids.password}>{t("password")}</Label>
        <Input
          id={ids.password}
          name="password"
          type="password"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          minLength={8}
          required
        />
        {mode === "register" ? (
          <p className="text-xs text-muted-foreground">{t("passwordHint")}</p>
        ) : null}
      </div>

      {errorCode ? (
        <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
          {t(errorKey)}
        </p>
      ) : null}

      <Button type="submit" size="lg" disabled={pending} className="mt-1 w-full">
        {pending ? t(`${mode}.submitting`) : t(`${mode}.submit`)}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        {mode === "login" ? t("login.noAccount") : t("register.hasAccount")}{" "}
        <Link
          href={mode === "login" ? "/register" : "/login"}
          className="font-medium text-primary hover:underline"
        >
          {mode === "login" ? t("login.toRegister") : t("register.toLogin")}
        </Link>
      </p>
    </form>
  );
}
