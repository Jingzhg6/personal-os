import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { buttonVariants } from "@/shared/ui/button";

export default async function NotFound() {
  const t = await getTranslations("shell.notFound");

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <p className="text-sm text-muted-foreground">{t("description")}</p>
      <Link href="/" className={buttonVariants({ variant: "secondary", className: "mt-3" })}>
        {t("back")}
      </Link>
    </div>
  );
}
