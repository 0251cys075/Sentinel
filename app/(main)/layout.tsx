import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { BottomNav } from "@/components/shell";

/**
 * Auth guard for every protected screen. Middleware already bounces
 * signed-out visitors to /landing; this server-side check is the
 * in-app backstop (and catches expired sessions on navigation).
 */
export default async function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/landing");
  }

  return (
    <div className="app-shell">
      <div className="screen">{children}</div>
      <BottomNav />
    </div>
  );
}
