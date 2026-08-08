"use client";

import { ThemeProvider } from "next-themes";
import { ToastProvider } from "@/components/toast";
import { AuthProvider } from "@/components/auth-provider";
import { SentinelProvider } from "@/hooks/useSentinelState";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="data-theme"
      defaultTheme="light"
      storageKey="sentinelTheme"
      enableSystem={false}
    >
      <ToastProvider>
        <AuthProvider>
          <SentinelProvider>{children}</SentinelProvider>
        </AuthProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
