import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import type { Meta, Tone } from "@/lib/domain";

// ---------------------------------------------------------------- badge

const TONE_TEXT: Record<Tone, string> = {
  slate: "text-slate",
  blue: "text-blue",
  violet: "text-violet",
  amber: "text-amber",
  green: "text-green",
  rose: "text-rose",
  cyan: "text-cyan",
  stone: "text-stone",
};

const TONE_BG: Record<Tone, string> = {
  slate: "bg-slate-soft",
  blue: "bg-blue-soft",
  violet: "bg-violet-soft",
  amber: "bg-amber-soft",
  green: "bg-green-soft",
  rose: "bg-rose-soft",
  cyan: "bg-cyan-soft",
  stone: "bg-stone-soft",
};

export function toneClasses(tone: Tone = "slate"): string {
  return `${TONE_TEXT[tone]} ${TONE_BG[tone]}`;
}

export function Badge({
  children,
  tone = "slate",
  size = "sm",
  dot = false,
  title,
  className = "",
}: {
  children: ReactNode;
  tone?: Tone | "accent";
  size?: "xs" | "sm";
  dot?: boolean;
  title?: string;
  className?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1.5 rounded-full font-medium whitespace-nowrap ${
        tone === "accent" ? "bg-accent-soft text-accent-ink" : toneClasses(tone)
      } ${
        size === "xs" ? "px-1.5 py-0.5 text-[10.5px]" : "px-2 py-0.5 text-[11.5px]"
      } ${className}`}
    >
      {dot ? <span className="size-1.5 rounded-full bg-current opacity-70" /> : null}
      {children}
    </span>
  );
}

export function StateBadge({ meta, pinned = false, size = "sm" }: { meta: Meta; pinned?: boolean; size?: "xs" | "sm" }) {
  return (
    <Badge tone={meta.tone} size={size} dot>
      {meta.label}
      {pinned ? <span className="opacity-60" title="set by hand">•</span> : null}
    </Badge>
  );
}

// ---------------------------------------------------------------- button

type ButtonProps = {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "subtle";
  size?: "xs" | "sm" | "md";
  href?: string;
  children: ReactNode;
  className?: string;
} & Omit<ComponentProps<"button">, "ref">;

const VARIANTS: Record<string, string> = {
  primary:
    "bg-accent text-white hover:bg-accent-hover active:translate-y-px shadow-[0_1px_2px_rgba(20,20,30,0.12)] border border-transparent",
  secondary: "bg-surface text-ink border border-line-strong hover:bg-surface-2 active:translate-y-px",
  ghost: "bg-transparent text-ink-2 border border-transparent hover:bg-surface-2",
  subtle: "bg-surface-2 text-ink-2 border border-transparent hover:bg-surface-3",
  danger: "bg-transparent text-rose border border-rose/30 hover:bg-rose-soft",
};

const SIZES: Record<string, string> = {
  xs: "h-6 px-2 text-[11.5px] gap-1 rounded-[6px]",
  sm: "h-7.5 px-2.5 text-[12.5px] gap-1.5 rounded-[7px]",
  md: "h-9 px-3.5 text-[13.5px] gap-2 rounded-[9px]",
};

export function Button({ variant = "secondary", size = "sm", href, children, className = "", ...rest }: ButtonProps) {
  const classes = `inline-flex items-center justify-center font-medium transition-all duration-100 disabled:opacity-45 disabled:pointer-events-none ${VARIANTS[variant]} ${SIZES[size]} ${className}`;
  if (href) {
    return (
      <Link href={href} className={classes}>
        {children}
      </Link>
    );
  }
  return (
    <button className={classes} {...rest}>
      {children}
    </button>
  );
}

// ---------------------------------------------------------------- card

export function Card({ children, className = "", padded = true }: { children: ReactNode; className?: string; padded?: boolean }) {
  return <div className={`panel ${padded ? "p-4" : ""} ${className}`}>{children}</div>;
}

export function CardHeader({
  title,
  hint,
  action,
  icon,
  className = "",
}: {
  title: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex items-start justify-between gap-3 ${className}`}>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {icon ? <span className="text-faint">{icon}</span> : null}
          <h2 className="text-[13.5px] font-semibold tracking-[-0.01em] text-ink">{title}</h2>
        </div>
        {hint ? <p className="mt-0.5 text-[12px] leading-snug text-muted">{hint}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function SectionTitle({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-3">
      <h2 className="text-[15px] font-semibold tracking-[-0.015em] text-ink">{children}</h2>
      {hint ? <p className="mt-0.5 text-[12.5px] text-muted">{hint}</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------- misc

export function EmptyState({
  title,
  hint,
  action,
  icon,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      {icon ? <div className="mb-1 text-faint opacity-70">{icon}</div> : null}
      <p className="text-[14px] font-medium text-ink">{title}</p>
      {hint ? <p className="max-w-sm text-[12.5px] leading-relaxed text-muted">{hint}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function Divider({ className = "" }: { className?: string }) {
  return <div className={`h-px w-full bg-line ${className}`} />;
}

export function Avatar({ name, hue = 210, size = 32 }: { name: string; hue?: number | null; size?: number }) {
  const letters = (name ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
  const h = hue ?? 210;
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        background: `linear-gradient(140deg, oklch(0.68 0.13 ${h}), oklch(0.55 0.16 ${(h + 28) % 360}))`,
      }}
      aria-hidden
    >
      {letters || "?"}
    </span>
  );
}

export function Progress({ value, tone = "accent", className = "" }: { value: number; tone?: Tone | "accent"; className?: string }) {
  const fill: Record<Tone | "accent", string> = {
    accent: "bg-accent",
    slate: "bg-slate",
    blue: "bg-blue",
    violet: "bg-violet",
    amber: "bg-amber",
    green: "bg-green",
    rose: "bg-rose",
    cyan: "bg-cyan",
    stone: "bg-stone",
  };
  return (
    <div className={`h-1.5 w-full overflow-hidden rounded-full bg-surface-3 ${className}`}>
      <div className={`h-full rounded-full ${fill[tone]}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

export function KeyValue({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="shrink-0 text-[12px] text-muted">{label}</span>
      <span className="min-w-0 truncate text-right text-[12.5px] text-ink">{children}</span>
    </div>
  );
}

export function Icon({ name, className = "" }: { name: IconName; className?: string }) {
  const common = `size-4 shrink-0 ${className}`;
  switch (name) {
    case "overview":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className={common} strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="7.5" height="8" rx="1.6" />
          <rect x="13.5" y="3" width="7.5" height="5" rx="1.6" />
          <rect x="13.5" y="11" width="7.5" height="10" rx="1.6" />
          <rect x="3" y="14" width="7.5" height="7" rx="1.6" />
        </svg>
      );
    case "inbox":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className={common} strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 13h4l1.5 3h7L17 13h4" />
          <path d="M5.5 5h13l2.5 8v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4Z" />
        </svg>
      );
    case "leads":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className={common} strokeLinecap="round" strokeLinejoin="round">
          <circle cx="9" cy="8" r="3.2" />
          <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
          <path d="M16 5.2a3.2 3.2 0 0 1 0 5.6M17.5 14.2A5.5 5.5 0 0 1 20.5 19" />
        </svg>
      );
    case "pipeline":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className={common} strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="5" height="16" rx="1.4" />
          <rect x="9.5" y="4" width="5" height="11" rx="1.4" />
          <rect x="16" y="4" width="5" height="7" rx="1.4" />
        </svg>
      );
    case "outreach":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className={common} strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h15A1.5 1.5 0 0 1 21 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5Z" />
          <path d="m3.5 7 8.5 6 8.5-6" />
        </svg>
      );
    case "followups":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className={common} strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12a8.5 8.5 0 1 1-2.6-6.1" />
          <path d="M21 4v5h-5" />
        </svg>
      );
    case "nurture":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className={common} strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 21c4.5-3 7-6.6 7-10a7 7 0 1 0-14 0c0 3.4 2.5 7 7 10Z" />
          <path d="M12 21V9" />
        </svg>
      );
    case "sources":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className={common} strokeLinecap="round" strokeLinejoin="round">
          <circle cx="6" cy="17" r="2.4" />
          <circle cx="12" cy="6" r="2.4" />
          <circle cx="18" cy="14" r="2.4" />
          <path d="m7.6 15.2 2.8-7M13.8 7.8l2.6 4.5M8.3 16.4l7.4-1.7" />
        </svg>
      );
    case "generate":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className={common} strokeLinecap="round" strokeLinejoin="round">
          <path d="m13 3-2.2 6.4a2 2 0 0 1-1.3 1.3L3 13l6.5 2.3a2 2 0 0 1 1.3 1.3L13 23l2.3-6.4a2 2 0 0 1 1.3-1.3L23 13l-6.4-2.3a2 2 0 0 1-1.3-1.3Z" />
        </svg>
      );
    case "tasks":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className={common} strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 6.5 5.5 8 8 5.5" />
          <path d="M4 12.5 5.5 14 8 11.5" />
          <path d="M4 18.5 5.5 20 8 17.5" />
          <path d="M11 6h9M11 12h9M11 18h9" />
        </svg>
      );
    case "analytics":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className={common} strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 19h16" />
          <path d="M7 19v-5M11.5 19V8M16 19v-8" />
        </svg>
      );
    case "settings":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className={common} strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 14a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5v.2a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H2a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H8a1.6 1.6 0 0 0 1-1.5V2a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V8a1.6 1.6 0 0 0 1.5 1h.2a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z" />
        </svg>
      );
    case "search":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={common} strokeLinecap="round">
          <circle cx="11" cy="11" r="6.5" />
          <path d="m16 16 4.5 4.5" />
        </svg>
      );
    case "plus":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={common} strokeLinecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
      );
    case "check":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className={common} strokeLinecap="round" strokeLinejoin="round">
          <path d="m5 12.5 4.5 4.5L19 7" />
        </svg>
      );
    case "arrow":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={common} strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      );
    case "chevron":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={common} strokeLinecap="round" strokeLinejoin="round">
          <path d="m9 6 6 6-6 6" />
        </svg>
      );
    case "close":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={common} strokeLinecap="round">
          <path d="m6 6 12 12M18 6 6 18" />
        </svg>
      );
    case "menu":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={common} strokeLinecap="round">
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      );
    case "spark":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className={common} strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 17.5 9 11l4 4 8-9" />
          <path d="M16 6h5v5" />
        </svg>
      );
    case "clock":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className={common} strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 7v5.2l3.2 2" />
        </svg>
      );
    case "alert":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className={common} strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 4.5 21 19H3Z" />
          <path d="M12 10v4" />
          <circle cx="12" cy="16.6" r="0.6" fill="currentColor" />
        </svg>
      );
    case "mail":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className={common} strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="5.5" width="18" height="13" rx="2" />
          <path d="m3.8 7 8.2 5.6L20.2 7" />
        </svg>
      );
    case "sun":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={common} strokeLinecap="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" />
        </svg>
      );
    case "moon":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={common} strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />
        </svg>
      );
    default:
      return null;
  }
}

export type IconName =
  | "overview"
  | "inbox"
  | "leads"
  | "pipeline"
  | "outreach"
  | "followups"
  | "nurture"
  | "sources"
  | "generate"
  | "tasks"
  | "analytics"
  | "settings"
  | "search"
  | "plus"
  | "check"
  | "arrow"
  | "chevron"
  | "close"
  | "menu"
  | "spark"
  | "clock"
  | "alert"
  | "mail"
  | "sun"
  | "moon";