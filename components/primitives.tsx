"use client";

/** Shared primitives that mirror the prototype's class vocabulary. */

export function Card({
  className = "",
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-card border border-line bg-card p-[18px] shadow-card ${className}`}
    >
      {children}
    </div>
  );
}

export function Tag({
  className = "",
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`rounded-[20px] bg-primary2 px-2.5 py-1.5 text-[11px] font-bold text-primary ${className}`}
    >
      {children}
    </span>
  );
}

export function Chip({
  selected,
  onClick,
  children,
}: {
  selected?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`whitespace-nowrap rounded-[20px] border px-3 py-2 text-xs ${
        selected
          ? "border-primary bg-primary2 text-primary"
          : "border-line bg-card text-text"
      }`}
    >
      {children}
    </button>
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="my-[14px]">
      <label className="mb-[7px] block text-xs text-muted">{label}</label>
      {children}
    </div>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  type = "text",
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  autoFocus?: boolean;
}) {
  return (
    <input
      className="w-full rounded-[13px] border border-line bg-card p-[14px] text-text outline-none"
      value={value}
      type={type}
      placeholder={placeholder}
      autoFocus={autoFocus}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function PrimaryButton({
  onClick,
  children,
  className = "",
  type = "button",
  disabled,
}: {
  onClick?: () => void;
  children: React.ReactNode;
  className?: string;
  type?: "button" | "submit";
  disabled?: boolean;
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`w-full rounded-[15px] bg-primary px-[18px] py-4 font-bold text-white shadow-[0_10px_24px_rgba(15,110,86,0.18)] disabled:opacity-60 ${className}`}
    >
      {children}
    </button>
  );
}

export function SecondaryButton({
  onClick,
  children,
  className = "",
}: {
  onClick?: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-[13px] bg-primary2 px-4 py-[13px] font-bold text-primary ${className}`}
    >
      {children}
    </button>
  );
}

export function Switch({
  on,
  onClick,
}: {
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onClick}
      className={`switch ${on ? "on" : ""}`}
    >
      <span />
    </button>
  );
}

export function OptRow({
  emoji,
  title,
  sub,
  danger,
  onClick,
}: {
  emoji: string;
  title: string;
  sub: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`mb-2.5 w-full rounded-card border p-4 text-left ${
        danger
          ? "border-danger bg-danger text-white"
          : "border-line bg-card shadow-card"
      }`}
    >
      <b className="text-[15px]">{emoji} {title}</b>
      <small className={`mt-1 block ${danger ? "text-white/60" : "text-muted"}`}>
        {sub}
      </small>
    </button>
  );
}

/** Bottom-sheet modal — same visual language as the prototype's `.sheet`. */
export function Sheet({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose?: () => void;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

export function MiniAvatar({ initials }: { initials: string }) {
  return <div className="miniavatar">{initials}</div>;
}

export function initialsOf(name: string): string {
  return (
    name
      .split(/\s+/)
      .map((w) => w[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?"
  );
}

/** Demo-only badge so it's always clear what's not a real integration. */
export function DemoBadge({ text = "Demo UI" }: { text?: string }) {
  return (
    <span className="rounded-[20px] border border-dashed border-accent/60 bg-accent/10 px-2.5 py-1 text-[10px] font-bold text-accent">
      ⚠ {text}
    </span>
  );
}
