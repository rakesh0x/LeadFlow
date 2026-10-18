"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import { importLeadsAction } from "@/app/actions";
import { Button } from "./ui";

const EXAMPLE = `name,email,company,title
jane doe,jane@acme.com,acme,head of growth
sam riordan,sam@northwind.io,northwind,founder
mira sol,mira@lumen.co,lumen,revenue lead`;

/** split one csv line, keeping quoted fields together. */
function splitLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      cells.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

const HEADER_ALIASES: Record<string, string[]> = {
  full_name: ["name", "full name", "full_name", "contact", "person"],
  email: ["email", "email address", "e-mail", "work email"],
  phone: ["phone", "phone number", "mobile", "telephone"],
  job_title: ["title", "job title", "role", "position"],
  company_name: ["company", "company name", "organisation", "organization", "account"],
  company_website: ["website", "site", "domain", "url"],
  location: ["location", "city", "country", "region"],
  industry: ["industry", "sector"],
  company_size: ["size", "company size", "employees", "headcount"],
};

/** csv text → row objects keyed the way the importer expects. */
export function parseCsv(text: string): Array<Record<string, string>> {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];

  const header = splitLine(lines[0]).map((h) => h.toLowerCase());
  const keys = header.map((h) => {
    const match = Object.keys(HEADER_ALIASES).find((key) => HEADER_ALIASES[key].includes(h));
    return match ?? h.replace(/\s+/g, "_");
  });

  const rows: Array<Record<string, string>> = [];
  for (const line of lines.slice(1)) {
    const cells = splitLine(line);
    const row: Record<string, string> = {};
    keys.forEach((key, i) => {
      const value = cells[i] ?? "";
      if (value) row[key] = value;
    });
    if (Object.keys(row).length) rows.push(row);
  }
  return rows;
}

export function CsvImporter({ sources }: { sources: Array<{ id: string; name: string }> }) {
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ added: number; matched: number; skipped: number; message: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const preview = useMemo(() => {
    if (!text.trim()) return [];
    return parseCsv(text).slice(0, 3);
  }, [text]);

  const totalPreview = useMemo(() => (text.trim() ? parseCsv(text).length : 0), [text]);

  const run = () => {
    setError(null);
    setResult(null);
    const rows = parseCsv(text);
    if (!rows.length) return setError("we could not find any rows in that — check there is a header line at the top");

    startTransition(async () => {
      const res = await importLeadsAction({
        name: name.trim() || "csv import",
        source_id: sourceId || null,
        rows,
      });
      if (!res.ok) return setError(res.error ?? "could not import that");

      const message = res.message ?? "done";
      const nums = message.match(/\d+/g)?.map(Number) ?? [rows.length, 0, 0];
      setResult({ added: nums[0] ?? 0, matched: nums[1] ?? 0, skipped: nums[2] ?? 0, message });
      setText("");
      setName("");
      router.refresh();
    });
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-[11.5px] font-medium text-muted">what should we call this import?</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className="field" placeholder="conference list, october" />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11.5px] font-medium text-muted">where did these people come from?</span>
          <select value={sourceId} onChange={(e) => setSourceId(e.target.value)} className="field">
            <option value="">no source</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="block">
        <span className="mb-1 flex items-center justify-between text-[11.5px] font-medium text-muted">
          paste your csv
          <button
            type="button"
            onClick={() => setText(EXAMPLE)}
            className="text-[11.5px] font-normal text-accent-ink hover:underline"
          >
            use an example
          </button>
        </span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={7}
          className="field resize-y font-mono text-[11.5px]"
          placeholder={"name,email,company,title\njane doe,jane@acme.com,acme,head of growth"}
        />
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv,text/plain"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const contents = await file.text();
            setText(contents);
            if (!name.trim()) setName(file.name.replace(/\.csv$/i, ""));
            e.target.value = "";
          }}
        />
        <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>
          choose a file
        </Button>
        <Button variant="primary" size="sm" onClick={run} disabled={pending || !text.trim()}>
          {pending ? "importing…" : `import${totalPreview ? ` ${totalPreview} people` : ""}`}
        </Button>
        {text.trim() ? <span className="text-[11.5px] text-faint">{totalPreview} rows ready</span> : null}
      </div>

      {preview.length ? (
        <div className="rounded-[9px] border border-line bg-surface-2/50 p-3">
          <p className="text-[11.5px] font-medium text-muted">first few rows</p>
          <ul className="mt-1.5 space-y-1">
            {preview.map((row, i) => (
              <li key={i} className="truncate text-[11.5px] text-ink-2">
                <span className="text-muted">{row.full_name ?? row.name ?? row.email ?? "unnamed"}</span>
                {row.email ? <span className="text-faint"> · {row.email}</span> : null}
                {row.company_name ?? row.company ? (
                  <span className="text-faint"> · {row.company_name ?? row.company}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {error ? <p className="text-[12px] text-rose">{error}</p> : null}

      {result ? (
        <div className="rounded-[9px] bg-green-soft px-3 py-2.5">
          <p className="text-[12.5px] font-medium text-green">{result.message}</p>
          <p className="mt-1 text-[11.5px] text-ink-2">
            {result.added} added, {result.matched} already on file
            {result.skipped ? `, ${result.skipped} we had to skip` : ""}. everyone went through the same duplicate check as a
            typed-in lead.
          </p>
        </div>
      ) : null}
    </div>
  );
}