"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createLeadAction } from "@/app/actions";
import { Button } from "./ui";

const EXAMPLE = `jane doe, jane@acme.com, acme, head of growth
sam riordan, sam@northwind.io, northwind, founder`;

function splitCells(line: string): string[] {
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
      } else current += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === "," || ch === ";" || ch === "\t") {
      cells.push(current.trim());
      current = "";
    } else current += ch;
  }
  cells.push(current.trim());
  return cells;
}

/** for lists you already have somewhere — one person per line. */
export function ManualPasteImport({ sources }: { sources: Array<{ id: string; name: string }> }) {
  const [text, setText] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<{ added: number; matched: number; skipped: number; firstError: string | null } | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const ready = lines.length;

  const run = () => {
    setError(null);
    setSummary(null);
    const parsed = lines.slice(0, 50).map(splitCells);
    if (!parsed.length) return setError("paste at least one line to get going");

    startTransition(async () => {
      let added = 0;
      let matched = 0;
      let skipped = 0;
      let firstError: string | null = null;

      for (const cells of parsed) {
        const [full_name, email, company_name, job_title] = cells;
        if (!full_name && !email) {
          skipped++;
          firstError ??= "a line had neither a name nor an email";
          continue;
        }
        const result = await createLeadAction({
          full_name: full_name || null,
          email: email || null,
          company_name: company_name || null,
          job_title: job_title || null,
          source_id: sourceId || null,
        });
        if (!result.ok) {
          skipped++;
          firstError ??= result.error ?? "a line did not save";
          continue;
        }
        if (result.message?.includes("already had this person")) matched++;
        else added++;
      }

      if (ready > 50) setError(`we only took the first 50 lines — there were ${ready}`);
      setSummary({ added, matched, skipped, firstError });
      setText("");
      router.refresh();
    });
  };

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="mb-1 flex items-center justify-between text-[11.5px] font-medium text-muted">
          one person per line
          <button type="button" onClick={() => setText(EXAMPLE)} className="text-[11.5px] font-normal text-accent-ink hover:underline">
            use an example
          </button>
        </span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          className="field resize-y font-mono text-[11.5px]"
          placeholder={"name, email, company, title"}
        />
        <span className="mt-1 block text-[11px] text-faint">
          name, email, company and job title. the email is what we match on, so leave it in if you have it.
        </span>
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-[11.5px] font-medium text-muted">where did they come from?</span>
          <select value={sourceId} onChange={(e) => setSourceId(e.target.value)} className="field">
            <option value="">no source</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end">
          <Button variant="primary" size="sm" onClick={run} disabled={pending || !ready}>
            {pending ? "adding…" : `add ${ready || ""} ${ready === 1 ? "person" : "people"}`.trim()}
          </Button>
        </div>
      </div>

      {error ? <p className="text-[12px] text-rose">{error}</p> : null}

      {summary ? (
        <div className="rounded-[9px] bg-green-soft px-3 py-2.5">
          <p className="text-[12.5px] font-medium text-green">
            {summary.added} added{summary.matched ? `, ${summary.matched} we already knew` : ""}
            {summary.skipped ? `, ${summary.skipped} skipped` : ""}
          </p>
          {summary.firstError ? <p className="mt-1 text-[11.5px] text-ink-2">first problem: {summary.firstError}</p> : null}
        </div>
      ) : null}
    </div>
  );
}