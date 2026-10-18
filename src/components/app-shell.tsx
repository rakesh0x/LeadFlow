"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Icon } from "./ui";
import { Sidebar, ThemeToggle, useSidebarState } from "./sidebar";
import { GlobalSearch } from "./global-search";
import { NewLeadButton } from "./new-lead-button";
import { NotificationsMenu, type Alert } from "./notifications";

export function AppShell({
  counts,
  children,
  memberName,
  memberHue,
  workspaceName,
  alertCount,
  alerts,
  sources,
}: {
  counts: Record<string, number>;
  children: ReactNode;
  memberName: string;
  memberHue: number;
  workspaceName: string;
  alertCount: number;
  alerts: Alert[];
  sources: Array<{ id: string; name: string }>;
}) {
  const { collapsed, toggle } = useSidebarState();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-canvas">
      {/* desktop sidebar */}
      <div className="hidden md:flex">
        <Sidebar collapsed={collapsed} onToggle={toggle} counts={counts} memberName={memberName} memberHue={memberHue} />
      </div>

      {/* mobile drawer */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <div className="fade absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
          <div className="slide-in relative z-10 h-full">
            <Sidebar collapsed={false} onToggle={() => setMobileOpen(false)} counts={counts} memberName={memberName} memberHue={memberHue} />
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-surface/85 px-3 backdrop-blur-md sm:px-5">
          <button
            onClick={() => setMobileOpen(true)}
            className="grid size-8 place-items-center rounded-[7px] text-muted hover:bg-surface-2 md:hidden"
            aria-label="open the menu"
          >
            <Icon name="menu" />
          </button>

          <Link href="/overview" className="hidden shrink-0 items-center gap-1.5 text-[12.5px] text-muted hover:text-ink lg:flex">
            {workspaceName}
            <Icon name="chevron" className="size-3 opacity-50" />
          </Link>

          <div className="mx-auto w-full max-w-md px-1 sm:px-4">
            <GlobalSearch />
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <NotificationsMenu alertCount={alertCount} alerts={alerts} />
            <ThemeToggle />
            <NewLeadButton sources={sources} />
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1440px] px-4 py-5 sm:px-6 sm:py-6">{children}</div>
        </main>
      </div>
    </div>
  );
}

/** consistent page heading across every section. */
export function PageHeader({
  title,
  hint,
  actions,
  tabs,
}: {
  title: string;
  hint?: ReactNode;
  actions?: ReactNode;
  tabs?: ReactNode;
}) {
  return (
    <div className="mb-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[21px] font-semibold tracking-[-0.025em] text-ink">{title}</h1>
          {hint ? <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-muted">{hint}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {tabs ? <div className="mt-4">{tabs}</div> : null}
    </div>
  );
}

export function Tabs({
  items,
  active,
  basePath,
}: {
  items: Array<{ label: string; value: string; count?: number }>;
  active: string;
  basePath: string;
}) {
  return (
    <nav className="flex flex-wrap items-center gap-1 border-b border-line">
      {items.map((item) => {
        const on = item.value === active;
        const href = item.value === "all" ? basePath : `${basePath}?view=${item.value}`;
        return (
          <Link
            key={item.value}
            href={href}
            className={`-mb-px border-b-2 px-2.5 pb-2 pt-1.5 text-[12.5px] transition-colors ${
              on ? "border-accent font-medium text-accent-ink" : "border-transparent text-muted hover:text-ink"
            }`}
          >
            {item.label}
            {item.count !== undefined ? (
              <span className={`num ml-1.5 text-[11px] ${on ? "text-accent-ink/70" : "text-faint"}`}>{item.count}</span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}