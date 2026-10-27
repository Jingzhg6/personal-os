"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { PageHeader } from "@/shared/ui/page-header";

import { RuleBuilder } from "./rule-builder";
import { useAutomationActions } from "./use-automation";

export function NewRuleView() {
  const t = useTranslations("automation");
  const router = useRouter();
  const { create } = useAutomationActions();
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6" data-testid="automation-new">
      <Link
        href="/automation"
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" aria-hidden />
        {t("detail.back")}
      </Link>
      <PageHeader title={t("builder.newTitle")} />
      <RuleBuilder
        pending={create.isPending}
        submitLabel={t("builder.saveDisabled")}
        note={t("builder.savedNote")}
        onCancel={() => router.push("/automation")}
        onSubmit={(config) =>
          create.mutate(config, { onSuccess: (rule) => router.push(`/automation/${rule.id}`) })
        }
      />
    </div>
  );
}
