"use client";

import { useEffect, useRef, useState } from "react";
import { Avatar, Icon } from "./ui";

export interface PickedLead {
  id: string;
  name: string;
}

interface Hit {
  id: string;
  full_name: string;
  email: string | null;
  company_name: string | null;
  job_title: string | null;
}

/**
 * search your people by name, email or company, then pick one.
 * hands back just an id and a name, which is all a task needs.
 */
export function LeadPicker({
  value,
  onChange,
  placeholder = "search someone to attach this to",
  autoFocus = false,
}: {
  value: PickedLead | null;
  onChange: (lead: PickedLead | null) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) setTimeout(() => inputRef.current?.focus(), 40);
  }, [autoFocus]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setHits([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`);
        const data = (await res.json()) as { hits?: Hit[] };
        setHits(data.hits ?? []);
        setOpen(true);
      } catch {
        setHits([]);
      } finally {
        setLoading(false);
      }
    }, 180);
    return () => clearTimeout(handle);
  }, [query]);

  if (value) {
    return (
      <div className="flex items-center gap-2 rounded-[7px] border border-line-strong bg-surface px-2 py-1.5">
        <Avatar name={value.name} size={22} />
        <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{value.name}</span>
        <button
          type="button"
          onClick={() => onChange(null)}
          className="grid size-5 place-items-center rounded text-faint transition-colors hover:bg-surface-2 hover:text-ink"
          title="pick someone else"
          aria-label="pick someone else"
        >
          <Icon name="close" className="size-3" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative" ref={wrapRef}>
      <div className="relative">
        <Icon name="search" className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          className="field pl-8"
          placeholder={placeholder}
          aria-label={placeholder}
        />
        {loading ? <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-faint">looking…</span> : null}
      </div>

      {open && query.trim() ? (
        <div className="slide-in absolute z-50 mt-1 max-h-[240px] w-full overflow-y-auto rounded-[9px] border border-line bg-surface py-1 shadow-lg">
          {hits.length === 0 ? (
            <p className="px-3 py-3 text-center text-[12px] text-muted">
              {loading ? "looking…" : `nobody matches “${query.trim()}”`}
            </p>
          ) : (
            <ul>
              {hits.map((hit) => (
                <li key={hit.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange({ id: hit.id, name: hit.full_name });
                      setQuery("");
                      setHits([]);
                      setOpen(false);
                    }}
                    className="flex w-full items-center gap-2.5 px-2.5 py-1.5 text-left transition-colors hover:bg-surface-2"
                  >
                    <Avatar name={hit.full_name} size={24} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] text-ink">{hit.full_name}</span>
                      <span className="block truncate text-[11px] text-muted">
                        {[hit.job_title, hit.company_name].filter(Boolean).join(" at ") || hit.email || "—"}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
