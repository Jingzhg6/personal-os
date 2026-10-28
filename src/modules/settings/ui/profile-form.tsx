"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useState, type FormEvent } from "react";

import { useTRPC } from "@/shared/trpc/react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { useToast } from "@/shared/ui/toast";
import { useErrorMessage } from "@/shared/ui/use-error-message";

import { NAME_MAX_LENGTH } from "../domain";

/** Display name (editable) and sign-in e-mail (shown only). */
export function ProfileForm({ name, email }: { name: string; email: string }) {
  const t = useTranslations("settings");
  const trpc = useTRPC();
  const router = useRouter();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const ids = { name: useId(), email: useId(), error: useId() };
  const [draft, setDraft] = useState(name);
  const [submitted, setSubmitted] = useState(false);
  const update = useMutation(
    trpc.settings.updateProfile.mutationOptions({
      onSuccess: (saved) => {
        setDraft(saved.name);
        setSubmitted(false);
        toast.show(t("saved"));
        router.refresh();
      },
      onError: (error) => toast.show(errorMessage(error), "error"),
    }),
  );

  const trimmed = draft.trim();
  const invalid = submitted && trimmed.length === 0;

  function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    if (trimmed.length === 0) return;
    update.mutate({ name: trimmed });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" data-testid="profile-form" noValidate>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={ids.name}>{t("profile.name")}</Label>
        <Input
          id={ids.name}
          value={draft}
          maxLength={NAME_MAX_LENGTH}
          autoComplete="name"
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? ids.error : undefined}
          onChange={(e) => setDraft(e.target.value)}
          data-testid="profile-name"
        />
        {invalid ? (
          <p id={ids.error} className="text-sm text-danger">
            {t("profile.nameRequired")}
          </p>
        ) : null}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={ids.email}>{t("profile.email")}</Label>
        <Input id={ids.email} value={email} readOnly disabled />
        <p className="text-xs text-muted-foreground">{t("profile.emailHint")}</p>
      </div>
      <div>
        <Button
          type="submit"
          disabled={update.isPending || trimmed === name}
          data-testid="profile-save"
        >
          {update.isPending ? t("saving") : t("save")}
        </Button>
      </div>
    </form>
  );
}
