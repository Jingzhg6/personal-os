"use client";

import { ThemeProvider } from "next-themes";
import type { ReactNode } from "react";

import { TRPCReactProvider } from "@/shared/trpc/react";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <TRPCReactProvider>{children}</TRPCReactProvider>
    </ThemeProvider>
  );
}
