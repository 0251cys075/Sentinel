"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { useToast } from "@/components/toast";
import { BrandMark, ThemeToggle } from "@/components/shell";
import { Card, Field, PrimaryButton, TextInput } from "@/components/primitives";

/**
 * Password recovery landing page.
 *
 * The reset link from resetPasswordForEmail() lands here with the recovery
 * token (PKCE code or hash). The Supabase browser client parses it on init,
 * so we wait for a session to appear and then let the user pick a new
 * password via auth.updateUser().
 */
function ResetForm() {
  const router = useRouter();
  const toast = useToast();

  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const supabase = getSupabaseBrowser();
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!data.session) {
          toast("This reset link is invalid or has expired");
          router.replace("/login");
          return;
        }
        setReady(true);
      })
      .catch(() => router.replace("/login"));
  }, [router, toast]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) return toast("Passwords don't match");
    if (password.length < 8)
      return toast("Password must be at least 8 characters");

    setBusy(true);
    try {
      const supabase = getSupabaseBrowser();
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      await supabase.auth.signOut();
      toast("Password updated — sign in with your new password");
      router.replace("/login");
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not update password");
      setBusy(false);
    }
  }

  if (!ready) {
    return (
      <Card>
        <p className="py-4 text-center text-sm text-muted">Checking link…</p>
      </Card>
    );
  }

  return (
    <Card>
      <form onSubmit={handleSubmit}>
        <Field label="NEW PASSWORD">
          <TextInput
            value={password}
            onChange={setPassword}
            type="password"
            placeholder="At least 8 characters"
            autoFocus
          />
        </Field>
        <Field label="CONFIRM PASSWORD">
          <TextInput
            value={confirm}
            onChange={setConfirm}
            type="password"
            placeholder="••••••••"
          />
        </Field>
        <PrimaryButton type="submit" disabled={busy}>
          {busy ? "Please wait…" : "Set new password"}
        </PrimaryButton>
      </form>
    </Card>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="app-shell">
      <div className="screen">
        <div className="mb-6 flex items-center justify-between">
          <BrandMark />
          <ThemeToggle />
        </div>

        <div className="pt-[20px]">
          <div className="eyebrow">Password recovery</div>
          <h1 className="font-display mt-2 text-[30px] leading-[1.1] tracking-[-0.03em]">
            Choose a new password.
          </h1>
          <p className="mb-6 mt-3 text-sm leading-[1.65] text-muted">
            Pick something strong — you&apos;ll use it to sign back in.
          </p>
          <Suspense fallback={<Card>Loading…</Card>}>
            <ResetForm />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
