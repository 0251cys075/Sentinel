"use client";

import { ThemeProvider } from "next-themes";
import { ToastProvider } from "@/components/toast";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="data-theme"
      defaultTheme="light"
      storageKey="sentinelTheme"
      enableSystem={false}
    >
      <ToastProvider>{children}</ToastProvider>
    </ThemeProvider>
  );
}
