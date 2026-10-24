"use client";

import { useMutation } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { cn } from "@/shared/lib/cn";
import { localeEndonyms, locales, localeStatus, type Locale } from "@/shared/i18n/config";
import { useTRPC } from "@/shared/trpc/react";
import { Badge } from "@/shared/ui/badge";

export function LanguageSettings({ current }: { current: Locale }) {
  const t = useTranslations("settings.language");
  const trpc = useTRPC();
  const router = useRouter();
  const update = useMutation(
    trpc.settings.update.mutationOptions({
      // Server components re-render with the new language; data is untouched.
      onSuccess: () => router.refresh(),
    }),
  );

  const selected = update.isPending && update.variables?.locale ? update.variables.locale : current;

  return (
    <div role="radiogroup" aria-label={t("title")} className="grid gap-2 sm:grid-cols-3">
      {locales.map((locale) => {
        const isSelected = locale === selected;
        return (
          <button
            key={locale}
            type="button"
            role="radio"
            aria-checked={isSelected}
            lang={locale}
            disabled={update.isPending}
            onClick={() => locale !== current && update.mutate({ locale })}
            className={cn(
              "flex items-center justify-between gap-2 rounded-md border px-3 py-2.5 text-left text-sm transition-colors",
              isSelected
                ? "border-primary bg-accent font-medium text-accent-foreground"
                : "border-border bg-surface hover:bg-surface-muted",
            )}
          >
            <span className="flex flex-col gap-1">
              {localeEndonyms[locale]}
              {localeStatus[locale] === "partial" ? (
                <Badge variant="outline" className="w-fit text-[10px]">
                  {t("incomplete")}
                </Badge>
              ) : null}
            </span>
            {isSelected ? <Check className="size-4 shrink-0 text-primary" /> : null}
          </button>
        );
      })}
    </div>
  );
}
