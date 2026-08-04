/**
 * Reads NEXT_PUBLIC_ env vars that the Next.js build inlines at compile time.
 *
 * IMPORTANT for Next's inlining: the read must be a literal, static
 * `process.env.VARIABLE` member expression in the source. That is why the
 * reads live here as literal expressions (not `process.env[name]`, a loop, or
 * a runtime-built config object) — anything dynamic would be silently left
 * undefined in the client/edge bundles even when correctly set in Vercel.
 */
function requireEnv(name: string, value: string | undefined): string {
  if (!value || !value.trim()) {
    throw new Error(
      'Missing Supabase env var "' +
        name +
        '". Set it in Vercel -> Settings -> Environment Variables ' +
        "(scope: Production and Preview) and in .env.local locally, " +
        "then redeploy."
    );
  }
  return value;
}

export const supabaseUrl = requireEnv(
  "NEXT_PUBLIC_SUPABASE_URL",
  process.env.NEXT_PUBLIC_SUPABASE_URL
);

export const supabaseAnonKey = requireEnv(
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);