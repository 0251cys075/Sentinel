"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { linkContactAccountToUser } from "@/lib/auth-links";
import { useToast } from "@/components/toast";
import { BrandMark, ThemeToggle } from "@/components/shell";
import { Card, Field, PrimaryButton, TextInput } from "@/components/primitives";

type Mode = "signin" | "signup";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();

  const [mode, setMode] = useState<Mode>("signin");
  const [forgot, setForgot] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const supabase = getSupabaseBrowser();

  function resetToggles() {
    setForgot(false);
    setSent(null);
  }

  function switchMode(next: Mode) {
    setMode(next);
    resetToggles();
  }

  /** Email sign-in with a password. */
  async function signInWithPassword() {
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;
      await linkContactAccountToUser();
      router.push(searchParams.get("next") || "/");
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Something went wrong");
      setBusy(false);
    }
  }

  /** Sign up with email + password. */
  async function signUp() {
    setBusy(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: fullName || email.split("@")[0] },
        },
      });

      if (error) {
        toast(error.message);
        return;
      }

      // If a session exists immediately, treat it as signed in and move on.
      if (data.session) {
        await linkContactAccountToUser();
        router.push(searchParams.get("next") || "/");
        router.refresh();
        return;
      }

      // Email confirmation may be disabled in Supabase — attempt a quick
      // password sign-in so the user isn't forced to wait for an email.
      const { data: signInData, error: signInError } =
        await supabase.auth.signInWithPassword({
          email,
          password,
        });
      if (signInData?.session) {
        await linkContactAccountToUser();
        router.push(searchParams.get("next") || "/");
        router.refresh();
      } else if (signInError) {
        setMode("signin");
        toast(
          "Account created! Please check your email to confirm or sign in."
        );
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  /**
   * Forgot-password link via Supabase's built-in resetPasswordForEmail() —
   * sends a reset email automatically, no extra cost. The recovery link lands
   * on /auth/reset-password where the token is exchanged and the user picks a
   * new password with updateUser().
   */
  async function sendForgot() {
    setBusy(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/reset-password`,
      });
      if (error) throw error;
      setSent("Check your inbox — we've sent a reset link.");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not send reset link");
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (forgot) return sendForgot();
    if (mode === "signin") return signInWithPassword();
    return signUp();
  }

  /**
   * Google OAuth. `window.location.origin` keeps the target correct across
   * environments (Vercel / localhost). The return URL goes through
   * /auth/callback — a public route — which exchanges the PKCE code and sets
   * the session cookie on the server BEFORE redirecting to "/". Redirecting
   * straight to "/" would fail, because "/" is a protected route: middleware
   * would bounce the code-less request to /landing and the browser would
   * never exchange the auth code.
   */
  const handleGoogleSignIn = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (error) console.error("Google Auth Error:", error.message);
  };

  if (sent) {
    return (
      <Card>
        <p className="text-sm leading-relaxed text-muted">{sent}</p>
        <PrimaryButton
          className="mt-4"
          onClick={() => resetToggles()}
        >
          Back to sign in
        </PrimaryButton>
      </Card>
    );
  }

  if (forgot) {
    return (
      <Card>
        <form onSubmit={handleSubmit}>
          <Field label="EMAIL">
            <TextInput
              value={email}
              onChange={setEmail}
              type="email"
              placeholder="you@example.com"
              autoFocus
            />
          </Field>
          <PrimaryButton type="submit" disabled={busy || !email}>
            {busy ? "Please wait…" : "Send reset link"}
          </PrimaryButton>
        </form>
        <button
          type="button"
          onClick={() => setForgot(false)}
          className="mt-4 w-full text-center text-sm font-bold text-primary"
        >
          Back to sign in
        </button>
      </Card>
    );
  }

  return (
    <Card>
      <form onSubmit={handleSubmit}>
        {mode === "signup" && (
          <Field label="FULL NAME">
            <TextInput
              value={fullName}
              onChange={setFullName}
              placeholder="e.g. Maya Iyer"
            />
          </Field>
        )}

        <Field label="EMAIL">
          <TextInput
            value={email}
            onChange={setEmail}
            type="email"
            placeholder="you@example.com"
            autoFocus={!sent}
          />
        </Field>

        <Field label="PASSWORD">
          <TextInput
            value={password}
            onChange={setPassword}
            type="password"
            placeholder="••••••••"
          />
        </Field>

        {mode === "signin" && (
          <div className="-mt-2 mb-4 text-right">
            <button
              type="button"
              onClick={() => setForgot(true)}
              className="text-sm font-bold text-primary"
            >
              Forgot password?
            </button>
          </div>
        )}

        <PrimaryButton type="submit" disabled={busy}>
          {busy
            ? "Please wait…"
            : mode === "signin"
              ? "Sign in"
              : "Create account"}
        </PrimaryButton>
      </form>

      <div className="my-4 flex items-center gap-3 text-xs text-muted">
        <span className="h-px flex-1 bg-line" />
        or
        <span className="h-px flex-1 bg-line" />
      </div>

      <button
        type="button"
        onClick={handleGoogleSignIn}
        disabled={busy}
        className="flex w-full items-center justify-center gap-3 rounded-[15px] border border-line bg-white px-[18px] py-4 font-bold text-text shadow-card disabled:opacity-60"
      >
        <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
          <path
            fill="#EA4335"
            d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
          />
          <path
            fill="#4285F4"
            d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
          />
          <path
            fill="#FBBC05"
            d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
          />
          <path
            fill="#34A853"
            d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
          />
        </svg>
        Continue with Google
      </button>

      <button
        type="button"
        onClick={() => switchMode(mode === "signin" ? "signup" : "signin")}
        className="mt-4 w-full text-center text-sm font-bold text-primary"
      >
        {mode === "signin"
          ? "New here? Create an account"
          : "Already have an account? Sign in"}
      </button>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <div className="app-shell">
      <div className="screen">
        <div className="mb-6 flex items-center justify-between">
          <BrandMark />
          <ThemeToggle />
        </div>

        <div className="pt-[20px]">
          <div className="eyebrow">Welcome to Sentinel</div>
          <h1 className="font-display mt-2 text-[30px] leading-[1.1] tracking-[-0.03em]">
            Sign in to stay protected.
          </h1>
          <p className="mb-6 mt-3 text-sm leading-[1.65] text-muted">
            Your journeys, trusted contacts and safety circle live here.
          </p>
          <Suspense fallback={<Card>Loading…</Card>}>
            <LoginForm />
          </Suspense>
        </div>
      </div>
    </div>
  );
}