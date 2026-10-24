"use client";

import { ThemeProvider } from "next-themes";
import type { ReactNode } from "react";

import { TRPCReactProvider } from "@/shared/trpc/react";
import { ToastProvider } from "@/shared/ui/toast";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <TRPCReactProvider>
        <ToastProvider>{children}</ToastProvider>
      </TRPCReactProvider>
    </ThemeProvider>
  );
}
