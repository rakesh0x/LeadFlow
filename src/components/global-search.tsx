"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./ui";
import { Avatar } from "./ui";

interface SearchHit {
  id: string;
  full_name: string;
  email: string | null;
  company_name: string | null;
  job_title: string | null;
  pipeline_stage: string;
}

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        setOpen((v) => !v);
      }
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 30);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const trimmed = query.trim();
    if (!trimmed) {
      setHits([]);
      return;
    }
    setLoading(true);
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`);
        const data = (await res.json()) as { hits: SearchHit[] };
        setHits(data.hits ?? []);
        setCursor(0);
      } catch {
        setHits([]);
      } finally {
        setLoading(false);
      }
    }, 160);
    return () => clearTimeout(handle);
  }, [query, open]);

  const go = (hit: SearchHit) => {
    setOpen(false);
    setQuery("");
    router.push(`/leads/${hit.id}`);
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex h-8 w-full items-center gap-2 rounded-[8px] border border-line bg-surface-2/60 px-2.5 text-left text-[12.5px] text-muted transition-colors hover:bg-surface-2"
      >
        <Icon name="search" className="size-3.5 shrink-0" />
        <span className="flex-1 truncate">search leads, companies, tasks…</span>
        <kbd className="hidden shrink-0 rounded border border-line px-1.5 py-px font-sans text-[10px] text-faint sm:inline">⌘k</kbd>
      </button>

      {open ? (
        <div className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[12vh]">
          <div className="fade absolute inset-0 bg-black/35 backdrop-blur-[2px]" onClick={() => setOpen(false)} />
          <div className="slide-in relative w-full max-w-xl overflow-hidden rounded-xl border border-line bg-surface shadow-lg">
            <div className="flex items-center gap-2.5 border-b border-line px-3.5 py-3">
              <Icon name="search" className="size-4 text-faint" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setCursor((c) => Math.min(c + 1, hits.length - 1));
                  }
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setCursor((c) => Math.max(c - 1, 0));
                  }
                  if (e.key === "Enter" && hits[cursor]) go(hits[cursor]);
                }}
                placeholder="search by name, email, company or job title"
                className="flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-faint"
              />
              <button onClick={() => setOpen(false)} className="grid size-6 place-items-center rounded text-faint hover:bg-surface-2" aria-label="close">
                <Icon name="close" className="size-3.5" />
              </button>
            </div>

            <div className="max-h-[52vh] overflow-y-auto">
              {!query.trim() ? (
                <div className="px-3.5 py-6 text-center text-[12.5px] text-muted">
                  start typing to find anyone in your workspace
                </div>
              ) : loading ? (
                <div className="px-3.5 py-6 text-center text-[12.5px] text-muted">looking…</div>
              ) : hits.length === 0 ? (
                <div className="px-3.5 py-6 text-center text-[12.5px] text-muted">nobody matches “{query}”</div>
              ) : (
                <ul className="py-1">
                  {hits.map((hit, i) => (
                    <li key={hit.id}>
                      <button
                        onMouseEnter={() => setCursor(i)}
                        onClick={() => go(hit)}
                        className={`flex w-full items-center gap-2.5 px-3.5 py-2 text-left transition-colors ${
                          i === cursor ? "bg-surface-2" : ""
                        }`}
                      >
                        <Avatar name={hit.full_name} size={28} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] text-ink">{hit.full_name}</span>
                          <span className="block truncate text-[11.5px] text-muted">
                            {[hit.job_title, hit.company_name].filter(Boolean).join(" at ") || hit.email}
                          </span>
                        </span>
                        <span className="shrink-0 rounded-full bg-surface-3 px-1.5 py-0.5 text-[10.5px] text-muted">
                          {hit.pipeline_stage.replaceAll("_", " ")}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {hits.length ? (
              <div className="flex items-center justify-between border-t border-line bg-surface-2/60 px-3.5 py-2 text-[11px] text-faint">
                <span>{hits.length} {hits.length === 1 ? "person" : "people"}</span>
                <span className="flex items-center gap-2">
                  <span>↑↓ to move</span>
                  <span>↵ to open</span>
                </span>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}