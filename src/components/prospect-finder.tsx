"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  importProspectsAction,
  revealEmailsAction,
  searchProspectsAction,
  skipProspectsAction,
  type DiscoveryResult,
} from "@/app/discovery-actions";
import type { CandidateView, SearchView } from "@/lib/prospecting/discovery";
import { Avatar, Badge, Button, EmptyState, Icon } from "./ui";

export interface DiscoveryFormProps {
  providerId: string;
  providerLabel: string;
  providerSupportsCompanies: boolean;
  providerProvidesEmail: boolean;
  seniorities: Array<{ value: string; label: string }>;
  sizes: Array<{ value: string; label: string }>;
  sources: Array<{ id: string; name: string }>;
  search: SearchView | null;
  candidates: CandidateView[];
}

/** describe who you are after. everything here becomes a real filter in the provider's api. */
export function ProspectFinder({ search, candidates, ...props }: DiscoveryFormProps) {
  const [kind, setKind] = useState<"people" | "companies">(search?.kind === "companies" ? "companies" : "people");
  const [titles, setTitles] = useState("");
  const [seniority, setSeniority] = useState<string[]>([]);
  const [industries, setIndustries] = useState("");
  const [companyLocations, setCompanyLocations] = useState("");
  const [employeeRanges, setEmployeeRanges] = useState<string[]>([]);
  const [domains, setDomains] = useState("");
  const [keywords, setKeywords] = useState("");
  const [result, setResult] = useState<DiscoveryResult | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const run = () => {
    setResult(null);
    startTransition(async () => {
      const outcome = await searchProspectsAction({
        provider: props.providerId,
        kind,
        titles,
        seniority: seniority.join(","),
        industries,
        companyLocations,
        employeeRanges: employeeRanges.join(","),
        domains,
        keywords,
        page: 1,
        perPage: 25,
      });
      setResult(outcome);
      if (outcome.ok) router.refresh();
    });
  };

  const toggleSize = (value: string) =>
    setEmployeeRanges((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));

  const toggleSeniority = (value: string) =>
    setSeniority((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-[8px] border border-line bg-surface-2/60 p-0.5">
          <button
            onClick={() => setKind("people")}
            className={`rounded-[6px] px-2.5 py-1 text-[12px] transition-colors ${
              kind === "people" ? "bg-surface font-medium text-ink shadow-xs" : "text-muted"
            }`}
          >
            decision-makers
          </button>
          <button
            onClick={() => setKind("companies")}
            disabled={!props.providerSupportsCompanies}
            className={`rounded-[6px] px-2.5 py-1 text-[12px] transition-colors disabled:opacity-40 ${
              kind === "companies" ? "bg-surface font-medium text-ink shadow-xs" : "text-muted"
            }`}
            title={props.providerSupportsCompanies ? undefined : "this provider cannot search for companies"}
          >
            companies
          </button>
        </div>
        <Badge tone="blue" size="xs">
          via {props.providerLabel}
        </Badge>
        {!props.providerProvidesEmail && kind === "people" ? (
          <Badge tone="amber" size="xs">
            addresses need a lookup
          </Badge>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {kind === "people" ? (
          <label className="block">
            <span className="mb-1 block text-[11.5px] font-medium text-muted">job title</span>
            <input
              value={titles}
              onChange={(e) => setTitles(e.target.value)}
              className="field"
              placeholder="head of growth, vp sales"
            />
            <span className="mt-1 block text-[11px] text-faint">comma separated. matched loosely by the provider.</span>
          </label>
        ) : null}

        <label className="block">
          <span className="mb-1 block text-[11.5px] font-medium text-muted">industry</span>
          <input
            value={industries}
            onChange={(e) => setIndustries(e.target.value)}
            className="field"
            placeholder="computer software, hospitals"
          />
          <span className="mt-1 block text-[11px] text-faint">
            use the provider's own industry names. apollo needs them exactly.
          </span>
        </label>

        <label className="block">
          <span className="mb-1 block text-[11.5px] font-medium text-muted">where the company is</span>
          <input
            value={companyLocations}
            onChange={(e) => setCompanyLocations(e.target.value)}
            className="field"
            placeholder="united states, united kingdom"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-[11.5px] font-medium text-muted">company domains (optional)</span>
          <input value={domains} onChange={(e) => setDomains(e.target.value)} className="field" placeholder="acme.com, initech.com" />
          <span className="mt-1 block text-[11px] text-faint">narrow to specific companies you already know about.</span>
        </label>
      </div>

      {kind === "people" ? (
        <div>
          <p className="mb-1.5 text-[11.5px] font-medium text-muted">seniority</p>
          <div className="flex flex-wrap gap-1.5">
            {props.seniorities.map((s) => (
              <button
                key={s.value}
                onClick={() => toggleSeniority(s.value)}
                className={`rounded-full border px-2.5 py-1 text-[11.5px] transition-colors ${
                  seniority.includes(s.value)
                    ? "border-accent bg-accent-soft font-medium text-accent-ink"
                    : "border-line text-muted hover:border-line-strong hover:text-ink"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div>
        <p className="mb-1.5 text-[11.5px] font-medium text-muted">company size</p>
        <div className="flex flex-wrap gap-1.5">
          {props.sizes.map((s) => (
            <button
              key={s.value}
              onClick={() => toggleSize(s.value)}
              className={`rounded-full border px-2.5 py-1 text-[11.5px] transition-colors ${
                employeeRanges.includes(s.value)
                  ? "border-accent bg-accent-soft font-medium text-accent-ink"
                  : "border-line text-muted hover:border-line-strong hover:text-ink"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <p className="mt-1 text-[11px] text-faint">leave every one off to include any size.</p>
      </div>

      <label className="block">
        <span className="mb-1 block text-[11.5px] font-medium text-muted">company keywords (optional)</span>
        <input value={keywords} onChange={(e) => setKeywords(e.target.value)} className="field" placeholder="analytics, logistics" />
      </label>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button variant="primary" size="sm" onClick={run} disabled={pending}>
          <Icon name="spark" className="size-3.5" />
          {pending ? "searching…" : "find real people"}
        </Button>
        <span className="text-[11.5px] text-faint">
          searching is free. revealing an email address is what costs credits.
        </span>
      </div>

      {result && !result.ok ? (
        <div className="rounded-[9px] border border-rose/30 bg-rose-soft px-3 py-2.5">
          <p className="text-[12.5px] font-medium text-rose">{result.error}</p>
          {result.detail ? <p className="mt-1 break-words text-[11px] text-rose/70">{result.detail}</p> : null}
          {result.retryable ? <p className="mt-1 text-[11px] text-muted">this one usually clears on its own. try again in a moment.</p> : null}
        </div>
      ) : null}

      {result?.ok && search ? <DiscoverySummary result={result} search={search} candidates={candidates} /> : null}
    </div>
  );
}

function DiscoverySummary({ result, search, candidates }: { result: DiscoveryResult; search: SearchView; candidates: CandidateView[] }) {
  const newCount = candidates.filter((c) => c.dupe_status === "new").length;
  const known = candidates.length - newCount;
  return (
    <div className="rise rounded-[9px] border border-line bg-surface-2/60 px-3 py-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-[13px] font-medium text-ink">
          {result.inserted} people staged for review
        </span>
        <span className="num text-[12px] text-muted">
          {newCount} new · {known} we already know · {search.total.toLocaleString()} matched that profile
        </span>
      </div>
      <p className="mt-1 text-[11.5px] text-muted">
        nothing has been added to your leads yet. review them below, then choose what comes across.
      </p>
    </div>
  );
}

/** review the staged people, flag the ones we already have, and import only what you pick. */
export function ProspectReview({
  candidates,
  search,
  sources,
  providerProvidesEmail,
}: {
  candidates: CandidateView[];
  search: SearchView;
  sources: Array<{ id: string; name: string }>;
  providerProvidesEmail: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sourceId, setSourceId] = useState("");
  const [includeLikely, setIncludeLikely] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // anything we have never seen starts ticked; probable duplicates do not.
  useEffect(() => {
    setSelected(new Set(candidates.filter((c) => c.dupe_status === "new" && c.import_state === "pending").map((c) => c.id)));
    setError(null);
    setMessage(null);
  }, [candidates]);

  const pending_ = useMemo(() => candidates.filter((c) => c.import_state === "pending"), [candidates]);
  const newOnes = useMemo(() => pending_.filter((c) => c.dupe_status === "new"), [pending_]);
  const likelyOnes = useMemo(() => pending_.filter((c) => c.dupe_status === "likely"), [pending_]);
  const exactOnes = useMemo(() => pending_.filter((c) => c.dupe_status === "exact"), [pending_]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const chooseAllNew = () => setSelected(new Set(newOnes.map((c) => c.id)));
  const chooseNone = () => setSelected(new Set());
  const chooseAll = () => setSelected(new Set(pending_.map((c) => c.id)));

  const needsLookup = useMemo(
    () => Array.from(selected).filter((id) => {
      const row = candidates.find((c) => c.id === id);
      return row ? !row.email : false;
    }),
    [selected, candidates],
  );

  const reveal = () => {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const outcome = await revealEmailsAction(needsLookup);
      if (!outcome.ok) setError(outcome.error ?? "could not look them up");
      else setMessage(outcome.message ?? "done");
      router.refresh();
    });
  };

  const runImport = () => {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const outcome = await importProspectsAction({
        candidateIds: Array.from(selected),
        sourceId: sourceId || null,
        includeLikelyDuplicates: includeLikely,
      });
      if (!outcome.ok) setError(outcome.error ?? "could not import them");
      else setMessage(outcome.message ?? "imported");
      setSelected(new Set());
      router.refresh();
    });
  };

  const runSkip = () => {
    startTransition(async () => {
      await skipProspectsAction(Array.from(selected));
      setSelected(new Set());
      router.refresh();
    });
  };

  if (!candidates.length) {
    return <EmptyState title="nothing staged yet" hint="run a search above and the results land here for review." />;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3 text-[12px] text-muted">
          <span>
            <span className="num text-ink">{newOnes.length}</span> new
          </span>
          <span>
            <span className="num text-amber">{likelyOnes.length}</span> probably ours
          </span>
          <span>
            <span className="num text-faint">{exactOnes.length}</span> already in the database
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button variant="ghost" size="xs" onClick={chooseAllNew}>
            tick the new ones
          </Button>
          <Button variant="ghost" size="xs" onClick={chooseAll}>
            tick everything
          </Button>
          <Button variant="ghost" size="xs" onClick={chooseNone}>
            tick none
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[880px] text-[12.5px]">
          <thead>
            <tr className="border-b border-line text-left">
              <th className="w-8 py-2" />
              <th className="px-2 py-2 text-[11px] font-medium text-faint">person</th>
              <th className="px-2 py-2 text-[11px] font-medium text-faint">company</th>
              <th className="px-2 py-2 text-[11px] font-medium text-faint">where</th>
              <th className="px-2 py-2 text-[11px] font-medium text-faint">contact</th>
              <th className="px-2 py-2 text-[11px] font-medium text-faint">our record</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {candidates.map((c) => {
              const done = c.import_state === "imported";
              const on = selected.has(c.id);
              return (
                <tr key={c.id} className={`transition-colors ${done ? "opacity-55" : on ? "bg-accent-soft/40" : ""}`}>
                  <td className="py-2 pl-1">
                    <input
                      type="checkbox"
                      checked={on || done}
                      disabled={done}
                      onChange={() => toggle(c.id)}
                      className="size-3.5 accent-[var(--accent)]"
                      aria-label={`select ${c.full_name}`}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex items-center gap-2">
                      <Avatar name={c.full_name} size={24} />
                      <div className="min-w-0">
                        <div className="truncate text-ink">{c.full_name}</div>
                        <div className="truncate text-[11px] text-muted">{c.job_title ?? "—"}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-2 py-2">
                    <div className="truncate text-ink-2">{c.company_name ?? "—"}</div>
                    <div className="truncate text-[11px] text-faint">
                      {[c.industry, c.company_size].filter(Boolean).join(" · ") || "—"}
                    </div>
                  </td>
                  <td className="px-2 py-2 text-[11.5px] text-muted">{c.location ?? "—"}</td>
                  <td className="px-2 py-2">
                    {c.email ? (
                      <a href={`mailto:${c.email}`} className="link truncate block text-[12px]">
                        {c.email}
                      </a>
                    ) : (
                      <span className="text-[11.5px] text-faint">
                        {c.email_status === "available on request" ? "address available" : "no address"}
                      </span>
                    )}
                    {c.linkedin_url ? (
                      <a
                        href={c.linkedin_url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="mt-0.5 block text-[10.5px] text-faint hover:text-accent-ink"
                      >
                        linkedin
                      </a>
                    ) : null}
                  </td>
                  <td className="px-2 py-2">
                    {done ? (
                      <Badge tone="green" size="xs">
                        added
                      </Badge>
                    ) : c.dupe_status === "exact" ? (
                      <span className="text-[11px] text-faint">already {c.dupe_lead_name ? `as ${c.dupe_lead_name}` : "in the database"}</span>
                    ) : c.dupe_status === "likely" ? (
                      <span className="text-[11px] text-amber">
                        {Math.round((c.dupe_confidence ?? 0) * 100)}% match{c.dupe_lead_name ? ` with ${c.dupe_lead_name}` : ""}
                      </span>
                    ) : (
                      <span className="text-[11px] text-green">new to us</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <label className="flex items-center gap-1.5">
          <span className="text-[11.5px] text-muted">count as</span>
          <select value={sourceId} onChange={(e) => setSourceId(e.target.value)} className="field h-7 w-auto py-0 text-[12px]">
            <option value="">no source</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>

        {likelyOnes.length ? (
          <label className="flex items-center gap-1.5 text-[11.5px] text-muted">
            <input type="checkbox" checked={includeLikely} onChange={(e) => setIncludeLikely(e.target.checked)} className="size-3.5 accent-[var(--accent)]" />
            also bring in the {likelyOnes.length} that look like people we have
          </label>
        ) : null}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span className="num text-[11.5px] text-muted">{selected.size} ticked</span>
          {!providerProvidesEmail && needsLookup.length ? (
            <Button variant="secondary" size="sm" onClick={reveal} disabled={pending}>
              {pending ? "looking…" : `look up ${needsLookup.length} ${needsLookup.length === 1 ? "address" : "addresses"}`}
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" onClick={runSkip} disabled={pending || selected.size === 0}>
            ignore
          </Button>
          <Button variant="primary" size="sm" onClick={runImport} disabled={pending || selected.size === 0}>
            {pending ? "adding…" : `add ${selected.size || ""} to leads`.trim()}
          </Button>
        </div>
      </div>

      {message ? <p className="text-[12px] text-green">{message}</p> : null}
      {error ? <p className="text-[12px] text-rose">{error}</p> : null}
      {search.has_more ? (
        <p className="text-[11.5px] text-faint">
          more people match this profile. run the search again to pull the next page.
        </p>
      ) : null}
    </div>
  );
}