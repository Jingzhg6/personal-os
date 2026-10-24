"use client";

import { useTranslations } from "next-intl";
import { useCallback } from "react";

interface ErrorWithDomainCode {
  data?: { domainCode?: string | null } | null;
}

/**
 * Maps an API error to a translated message: `errors.<domainCode>` when the server sent a
 * known business-rule code, otherwise a generic message.
 */
export function useErrorMessage() {
  const t = useTranslations("errors");
  return useCallback(
    (error: unknown): string => {
      const code = (error as ErrorWithDomainCode | null)?.data?.domainCode;
      // Keys are nested by the dots in the code, e.g. "task.not_found" → errors.task.not_found.
      return code && t.has(code as "generic") ? t(code as "generic") : t("generic");
    },
    [t],
  );
}
