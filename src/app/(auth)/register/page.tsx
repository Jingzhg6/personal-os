import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { getSession } from "@/server/session";
import { getEnv } from "@/shared/config/env";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import { AuthForm } from "@/shell/auth/auth-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.register");
  return { title: t("title") };
}

export default async function RegisterPage() {
  if (await getSession()) redirect("/dashboard");
  const t = await getTranslations("auth");

  return (
    <Card className="w-full shadow-md">
      <CardHeader>
        <CardTitle level={1} className="text-xl">
          {t("register.title")}
        </CardTitle>
        <CardDescription>{t("register.subtitle")}</CardDescription>
      </CardHeader>
      <CardContent>
        {getEnv().AUTH_ALLOW_SIGNUP ? (
          <Suspense>
            <AuthForm mode="register" />
          </Suspense>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t("errors.EMAIL_PASSWORD_SIGN_UP_DISABLED")}{" "}
            <Link href="/login" className="font-medium text-primary hover:underline">
              {t("register.toLogin")}
            </Link>
          </p>
        )}
      </CardContent>
    </Card>
  );
}
