"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { linkContactAccountToUser } from "@/lib/auth-links";
import { useToast } from "@/components/toast";
import { BrandMark, ThemeToggle } from "@/components/shell";
import { Card, Field, PrimaryButton, TextInput } from "@/components/primitives";

type Method = "email" | "phone";
type Mode = "signin" | "signup";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();

  const [method, setMethod] = useState<Method>("email");
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);

  const supabase = getSupabaseBrowser();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (method === "email") {
        if (mode === "signin") {
          const { error } = await supabase.auth.signInWithPassword({
            email,
            password,
          });
          if (error) throw error;
        } else {
          const { data, error } = await supabase.auth.signUp({
            email,
            password,
            options: {
              data: { full_name: fullName || email.split("@")[0] },
            },
          });
          if (error) throw error;
          if (!data.session) {
            toast("Account created — check your email to confirm");
            setMode("signin");
            return;
          }
        }
      } else {
        const { error } = await supabase.auth.signInWithOtp({
          phone,
          options: { data: { full_name: fullName || phone } },
        });
        if (error) throw error;
        toast("OTP sent — enter it to complete sign-in");
        return;
      }
      await linkContactAccountToUser();
      router.push(searchParams.get("next") || "/");
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div className="mb-4 flex rounded-[14px] border border-line bg-card p-1">
        {(["email", "phone"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMethod(m)}
            className={`flex-1 rounded-[10px] py-2.5 text-sm font-bold capitalize ${
              method === m ? "bg-primary2 text-primary" : "text-muted"
            }`}
          >
            {m}
          </button>
        ))}
      </div>

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

        {method === "email" ? (
          <Field label="EMAIL">
            <TextInput
              value={email}
              onChange={setEmail}
              type="email"
              placeholder="you@example.com"
              autoFocus
            />
          </Field>
        ) : (
          <Field label="PHONE NUMBER">
            <TextInput
              value={phone}
              onChange={setPhone}
              type="tel"
              placeholder="+91 98765 43210"
              autoFocus
            />
          </Field>
        )}

        {method === "email" && (
          <Field label="PASSWORD">
            <TextInput
              value={password}
              onChange={setPassword}
              type="password"
              placeholder="••••••••"
            />
          </Field>
        )}

        {method === "phone" && (
          <p className="mb-4 text-xs leading-relaxed text-muted">
            We&apos;ll text you a one-time code. Phone OTP must be enabled in
            your Supabase Auth settings.
          </p>
        )}

        <PrimaryButton type="submit" disabled={busy}>
          {busy
            ? "Please wait…"
            : method === "email" && mode === "signin"
              ? "Sign in"
              : "Create account"}
        </PrimaryButton>
      </form>

      <button
        type="button"
        onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
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
