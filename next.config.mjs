/** @type {import('next').NextConfig} */
const nextConfig = {};

const REQUIRED_PUBLIC_ENV = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
];

for (const name of REQUIRED_PUBLIC_ENV) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(
      `[build] Missing required env var "${name}". ` +
        "Add it in Vercel -> Settings -> Environment Variables (scope: " +
        "Production and Preview), then redeploy. Without it the Supabase " +
        "client is built with an empty URL/key and crashes at runtime."
    );
  }
}

export default nextConfig;
