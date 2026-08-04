"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

/** Round icon button used across every screen (back, theme, close). */
export function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="grid h-[42px] w-[42px] place-items-center rounded-full bg-card shadow-card"
    >
      {children}
    </button>
  );
}

/** ☼ / ☾ theme toggle — same button in the prototype, same storage key. */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <IconButton
      label="Toggle theme"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      {mounted && resolvedTheme === "dark" ? "☾" : "☼"}
    </IconButton>
  );
}

export function BrandMark() {
  return (
    <span className="font-display flex items-center gap-2.5 text-lg font-extrabold">
      <span className="brandmark">◈</span>
      Sentinel
    </span>
  );
}

/** Standard top row: back / title / theme toggle. */
export function TopBar({
  title,
  eyebrow,
  backTo,
  onBack,
}: {
  title: string;
  eyebrow?: string;
  backTo?: string;
  onBack?: () => void;
}) {
  const handleBack = () => {
    if (onBack) {
      onBack();
    } else if (window.history.length > 1) {
      window.history.back();
    } else {
      window.location.href = "/";
    }
  };

  return (
    <div className="mb-6 flex items-center justify-between">
      {backTo ? (
        <Link
          href={backTo}
          aria-label="Back"
          className="grid h-[42px] w-[42px] place-items-center rounded-full bg-card shadow-card"
        >
          ←
        </Link>
      ) : (
        <button
          type="button"
          aria-label="Back"
          onClick={handleBack}
          className="grid h-[42px] w-[42px] place-items-center rounded-full bg-card shadow-card"
        >
          ←
        </button>
      )}
      <div className="text-center">
        {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
        <b>{title}</b>
      </div>
      <ThemeToggle />
    </div>
  );
}

export function BottomNav() {
  const pathname = usePathname();
  const items = [
    { href: "/", label: "Home", icon: "⌂" },
    { href: "/route", label: "Routes", icon: "⌖" },
    { href: "/contacts", label: "Contacts", icon: "◌" },
    { href: "/settings", label: "Settings", icon: "⚙" },
  ];

  return (
    <nav className="nav">
      {items.map((item) => {
        const active =
          item.href === "/"
            ? pathname === "/"
            : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`text-center text-[10px] no-underline ${
              active ? "font-bold text-primary" : "text-muted"
            }`}
          >
            <i className="mb-0.5 block text-[20px] not-italic">{item.icon}</i>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Full-screen shell for authed routes: screen + bottom nav. */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell">
      <div className="screen">{children}</div>
      <BottomNav />
    </div>
  );
}
