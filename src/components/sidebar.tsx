"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon, type IconName } from "./ui";

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  /** matched for highlighting — defaults to href */
  match?: string;
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

export const NAV: NavSection[] = [
  {
    title: "work",
    items: [
      { href: "/overview", label: "overview", icon: "overview" },
      { href: "/inbox", label: "lead inbox", icon: "inbox", match: "/inbox" },
      { href: "/leads", label: "all leads", icon: "leads", match: "/leads" },
      { href: "/pipeline", label: "pipeline", icon: "pipeline" },
      { href: "/tasks", label: "tasks", icon: "tasks" },
    ],
  },
  {
    title: "outbound",
    items: [
      { href: "/outreach", label: "outreach", icon: "outreach" },
      { href: "/follow-ups", label: "follow-ups", icon: "followups" },
      { href: "/nurture", label: "nurture", icon: "nurture" },
    ],
  },
  {
    title: "acquisition",
    items: [
      { href: "/sources", label: "lead sources", icon: "sources" },
      { href: "/generate", label: "lead generation", icon: "generate" },
      { href: "/analytics", label: "analytics", icon: "analytics" },
    ],
  },
  {
    title: "workspace",
    items: [{ href: "/settings", label: "settings", icon: "settings" }],
  },
];

export const ALL_NAV_ITEMS = NAV.flatMap((s) => s.items);

const STORAGE_KEY = "leadflow:sidebar";

export function Sidebar({
  collapsed,
  onToggle,
  counts,
  memberName,
  memberHue,
}: {
  collapsed: boolean;
  onToggle: () => void;
  counts: Record<string, number>;
  memberName: string;
  memberHue: number;
}) {
  const pathname = usePathname();

  return (
    <aside
      className={`relative flex h-full shrink-0 flex-col border-r border-line bg-surface transition-[width] duration-200 ${
        collapsed ? "w-[62px]" : "w-[228px]"
      }`}
    >
      <div className={`flex h-14 items-center gap-2.5 border-b border-line ${collapsed ? "justify-center px-2" : "px-4"}`}>
        <Link href="/overview" className="flex min-w-0 items-center gap-2.5">
          <span
            className="grid size-7 shrink-0 place-items-center rounded-[8px] text-[13px] font-bold text-white"
            style={{ background: "linear-gradient(140deg, var(--accent), oklch(0.62 0.19 292))" }}
          >
            l
          </span>
          {!collapsed ? <span className="truncate text-[14.5px] font-semibold tracking-[-0.02em]">leadflow</span> : null}
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3">
        {NAV.map((section) => (
          <div key={section.title} className="mb-4 last:mb-0">
            {!collapsed ? (
              <p className="mb-1 px-2 text-[10.5px] font-medium uppercase tracking-[0.07em] text-faint">{section.title}</p>
            ) : (
              <div className="mx-2 mb-2 h-px bg-line" />
            )}
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const match = item.match ?? item.href;
                const active = pathname === match || pathname.startsWith(`${match}/`);
                const count = counts[item.href];
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      title={collapsed ? item.label : undefined}
                      className={`group flex h-8 items-center gap-2.5 rounded-[7px] text-[13px] transition-colors ${
                        collapsed ? "justify-center px-0" : "px-2"
                      } ${
                        active
                          ? "bg-accent-soft font-medium text-accent-ink"
                          : "text-ink-2 hover:bg-surface-2 hover:text-ink"
                      }`}
                    >
                      <Icon name={item.icon} className={active ? "opacity-100" : "opacity-70"} />
                      {!collapsed ? <span className="flex-1 truncate">{item.label}</span> : null}
                      {!collapsed && count ? (
                        <span
                          className={`num rounded-full px-1.5 py-px text-[10.5px] font-medium ${
                            active ? "bg-accent/15 text-accent-ink" : "bg-surface-3 text-muted"
                          }`}
                        >
                          {count > 999 ? "999+" : count}
                        </span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-line p-2">
        <div className={`flex items-center gap-2 rounded-[7px] px-1.5 py-1.5 ${collapsed ? "justify-center" : ""}`}>
          <span
            className="grid size-6 shrink-0 place-items-center rounded-full text-[10.5px] font-semibold text-white"
            style={{ background: `linear-gradient(140deg, oklch(0.68 0.13 ${memberHue}), oklch(0.55 0.16 ${(memberHue + 28) % 360}))` }}
          >
            {memberName.slice(0, 2).toUpperCase()}
          </span>
          {!collapsed ? (
            <>
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{memberName}</span>
              <button
                onClick={onToggle}
                className="grid size-6 place-items-center rounded-[6px] text-faint transition-colors hover:bg-surface-2 hover:text-ink"
                title="collapse the sidebar"
                aria-label="collapse the sidebar"
              >
                <Icon name="chevron" className="size-3.5 rotate-180" />
              </button>
            </>
          ) : null}
        </div>
        {collapsed ? (
          <button
            onClick={onToggle}
            className="mx-auto mt-1 grid size-7 place-items-center rounded-[6px] text-faint transition-colors hover:bg-surface-2 hover:text-ink"
            title="expand the sidebar"
            aria-label="expand the sidebar"
          >
            <Icon name="chevron" className="size-3.5" />
          </button>
        ) : null}
      </div>
    </aside>
  );
}

export function ThemeToggle() {
  const [dark, setDark] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("leadflow:theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const isDark = stored ? stored === "dark" : prefersDark;
    document.documentElement.classList.toggle("dark", isDark);
    setDark(isDark);
    setReady(true);
  }, []);

  if (!ready) return <div className="size-7.5" />;

  return (
    <button
      onClick={() => {
        const next = !dark;
        document.documentElement.classList.toggle("dark", next);
        localStorage.setItem("leadflow:theme", next ? "dark" : "light");
        setDark(next);
      }}
      className="grid size-7.5 place-items-center rounded-[7px] border border-line text-muted transition-colors hover:bg-surface-2 hover:text-ink"
      title={dark ? "switch to light" : "switch to dark"}
      aria-label={dark ? "switch to light" : "switch to dark"}
    >
      <Icon name={dark ? "sun" : "moon"} className="size-4" />
    </button>
  );
}

export function useSidebarState() {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    setCollapsed(localStorage.getItem(STORAGE_KEY) === "1");
  }, []);
  const toggle = () => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      return next;
    });
  };
  return { collapsed, toggle };
}