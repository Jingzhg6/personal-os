import { Hexagon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

import { ThemeToggle } from "@/shell/theme-toggle";

export default async function AuthLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations("common");

  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-4 py-10">
      <div
        aria-hidden
        className="pointer-events-none absolute top-[-20%] left-1/2 h-[480px] w-[720px] -translate-x-1/2 rounded-full bg-primary/10 blur-3xl"
      />
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <div className="relative flex w-full max-w-sm flex-col items-center gap-6">
        <div className="flex flex-col items-center gap-2">
          <span className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-md">
            <Hexagon className="size-5" strokeWidth={2.5} />
          </span>
          <span className="text-sm font-medium text-muted-foreground">{t("appName")}</span>
        </div>
        {children}
      </div>
    </div>
  );
}
