import Link from "next/link";
import { db } from "@/lib/db/client";
import { requireWorkspaceId } from "@/lib/workspace";
import { humanize } from "@/lib/db/time";
import { queryLeads } from "@/lib/queries/leads";
import { listSources } from "@/lib/queries/sources";
import { sourcePerformance } from "@/lib/queries/analytics";
import { SOURCE_KIND_META } from "@/lib/domain";
import { Badge, Card, CardHeader, EmptyState, Icon, KeyValue } from "@/components/ui";
import { BarRow } from "@/components/charts";
import { PageHeader } from "@/components/app-shell";
import { LeadRow } from "@/components/lead-row";
import { ManualPasteImport } from "@/components/manual-paste-import";
import { ConnectionBadge, ProviderSetup, type ProviderCardData } from "@/components/provider-setup";
import { ProspectFinder, ProspectReview } from "@/components/prospect-finder";
import { getSearch, listCandidates, listSearches } from "@/lib/prospecting/discovery";
import { credentialStatuses, firstConfiguredProvider, getProvider, PROVIDER_LIST } from "@/lib/prospecting";

export const dynamic = "force-dynamic";

export default async function GeneratePage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string }>;
}) {
  const params = await searchParams;
  const database = db();
  const workspaceId = requireWorkspaceId(database);

  const sources = listSources(workspaceId, database);
  const pick = sources.map((s) => ({ id: s.id, name: s.name }));
  const performance = sourcePerformance(workspaceId, database);
  const recent = queryLeads(workspaceId, { isNew: true, sort: "newest", limit: 6 }, database);

  const statuses = credentialStatuses(workspaceId);
  const connected = statuses.filter((s) => s.configured);
  const provider = firstConfiguredProvider(workspaceId);

  const recentSearches = listSearches(workspaceId, 8, database);
  const activeSearchId = params.search ?? recentSearches[0]?.id ?? null;
  const activeSearch = activeSearchId ? getSearch(workspaceId, activeSearchId, database) : null;
  const candidates = activeSearch ? listCandidates(workspaceId, activeSearch.id, {}, database) : [];

  const providerCards: ProviderCardData[] = PROVIDER_LIST.map((p) => ({
    id: p.id,
    info: p.info,
    status: statuses.find((s) => s.provider === p.id) ?? null,
  }));

  const best = performance.filter((p) => p.total > 0).slice(0, 5);
  const bestMax = Math.max(...best.map((p) => p.total), 1);
  const totalLeads = performance.reduce((sum, p) => sum + p.total, 0);

  return (
    <div>
      <PageHeader
        title="lead generation"
        hint="find real companies and the people who decide things at them, then bring the ones you want into your workspace."
      />

      {provider && activeSearch ? (
        <Card padded={false} className="mb-4">
          <div className="border-b border-line px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-[13.5px] font-semibold tracking-[-0.01em]">review before anything is added</h2>
                <p className="mt-0.5 text-[12px] text-muted">
                  {activeSearch.query_label} · {activeSearch.returned} staged · found {humanize(activeSearch.created_at)}
                  {activeSearch.credits_used ? ` · ${activeSearch.credits_used} credits` : " · no credits used"}
                </p>
              </div>
              <Badge tone="blue" size="xs">
                {activeSearch.provider}
              </Badge>
            </div>
          </div>
          <div className="p-3">
            <ProspectReview
              candidates={candidates}
              search={activeSearch}
              sources={pick}
              providerProvidesEmail={provider.info.providesEmailOnSearch}
            />
          </div>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {provider ? (
            <Card>
              <CardHeader
                title="find some people"
                hint={`describing who you want. results come from ${provider.info.label} and land here for review before anything is added.`}
                icon={<Icon name="spark" className="size-4" />}
                action={<ConnectionBadge status={statuses.find((s) => s.provider === provider.id) ?? null} />}
              />
              <div className="mt-3.5">
                <ProspectFinder
                  providerId={provider.id}
                  providerLabel={provider.info.label}
                  providerSupportsCompanies={provider.info.kinds.includes("companies")}
                  providerProvidesEmail={provider.info.providesEmailOnSearch}
                  seniorities={SENIORITY}
                  sizes={SIZES}
                  sources={pick}
                  search={activeSearch}
                  candidates={candidates}
                />
              </div>
            </Card>
          ) : (
            <ProviderSetup providers={providerCards} />
          )}

          {provider && !activeSearch && recentSearches.length ? (
            <Card>
              <CardHeader title="earlier searches" hint="pick one to look at it again" />
              <ul className="mt-3 space-y-1">
                {recentSearches.map((s) => (
                  <li key={s.id}>
                    <Link
                      href={`/generate?search=${s.id}`}
                      className="flex items-center gap-2.5 rounded-[7px] px-1.5 py-1.5 transition-colors hover:bg-surface-2"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12.5px] text-ink">{s.query_label}</span>
                        <span className="block truncate text-[11px] text-muted">
                          {s.provider} · {s.returned} people · {humanize(s.created_at)}
                        </span>
                      </span>
                      {s.new_count ? (
                        <Badge tone="green" size="xs">
                          {s.new_count} to review
                        </Badge>
                      ) : null}
                      {s.imported_count ? (
                        <Badge tone="slate" size="xs">
                          {s.imported_count} added
                        </Badge>
                      ) : null}
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          <Card>
            <CardHeader title="paste your own list" hint="you already have the people, we just need them in here" />
            <div className="mt-3.5">
              <ManualPasteImport sources={pick} />
            </div>
          </Card>

          <Card padded={false}>
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <div>
                <h2 className="text-[13.5px] font-semibold tracking-[-0.01em]">waiting in the inbox</h2>
                <p className="mt-0.5 text-[12px] text-muted">newest first. nobody has looked at these yet.</p>
              </div>
              <Link href="/inbox" className="shrink-0 text-[12px] text-accent-ink hover:underline">
                open the inbox
              </Link>
            </div>
            {recent.rows.length === 0 ? (
              <EmptyState
                title="the inbox is empty"
                hint="find some people above, or paste a list you already have."
                icon={<Icon name="inbox" className="size-5" />}
              />
            ) : (
              <div className="px-2 py-2">
                {recent.rows.map((lead) => (
                  <LeadRow key={lead.id} lead={lead} />
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          {provider ? (
            <Card>
              <CardHeader title="where your data is coming from" hint="one key is enough. two is handy if one runs out." />
              <ul className="mt-3 space-y-2">
                {providerCards.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2">
                    <a
                      href={p.info.docsUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="truncate text-[12.5px] text-ink hover:underline"
                    >
                      {p.info.label}
                    </a>
                    <ConnectionBadge status={p.status} />
                  </li>
                ))}
              </ul>
              <details className="mt-3">
                <summary className="cursor-pointer text-[12px] text-accent-ink hover:underline">connect or change a provider</summary>
                <div className="mt-3">
                  <ProviderSetup providers={providerCards} />
                </div>
              </details>
            </Card>
          ) : null}

          <Card>
            <CardHeader title="where leads actually come from" hint="your own numbers, not a benchmark" />
            {best.length === 0 ? (
              <p className="py-5 text-center text-[12.5px] text-muted">
                nothing to compare yet. once leads start arriving, the sources that earn replies show up here.
              </p>
            ) : (
              <div className="mt-4 space-y-2.5">
                {best.map((row) => {
                  const kind = SOURCE_KIND_META[row.kind as keyof typeof SOURCE_KIND_META];
                  return (
                    <BarRow
                      key={row.id}
                      label={row.name}
                      value={row.total}
                      max={bestMax}
                      tone={kind ? `var(--${kind.tone === "stone" ? "stone" : kind.tone})` : "var(--accent)"}
                      right={
                        <>
                          <span className="num text-ink">{row.total}</span>
                          {row.replied ? <span className="ml-1.5 text-faint">{row.replied} replied</span> : null}
                        </>
                      }
                      href={`/leads?source=${encodeURIComponent(row.name)}`}
                    />
                  );
                })}
              </div>
            )}
            <p className="mt-3 border-t border-line pt-2.5 text-[11.5px] leading-relaxed text-faint">
              honest answer: buying a list fills your inbox. it does not make anyone reply. the sources above are what
              actually turn into conversations.
            </p>
          </Card>

          <Card>
            <CardHeader title="how this stays honest" />
            <ul className="mt-3 space-y-2.5 text-[12.5px] leading-relaxed text-muted">
              <li className="flex gap-2.5">
                <Icon name="check" className="mt-0.5 size-3.5 shrink-0 text-green" />
                <span>
                  <span className="text-ink-2">nothing is invented.</span> every name, company and address shown here
                  came back from {provider?.info.label ?? "the provider"}. if you have no api key, this page shows you how to
                  get one instead of a made-up list.
                </span>
              </li>
              <li className="flex gap-2.5">
                <Icon name="check" className="mt-0.5 size-3.5 shrink-0 text-green" />
                <span>
                  <span className="text-ink-2">you see duplicates before they arrive.</span> every candidate goes through
                  the same matcher your leads use. certain matches never get imported, and probable ones sit unticked
                  until you say otherwise.
                </span>
              </li>
              <li className="flex gap-2.5">
                <Icon name="check" className="mt-0.5 size-3.5 shrink-0 text-green" />
                <span>
                  <span className="text-ink-2">addresses are only stored if they exist.</span> a person with no address
                  still gets added — with their linkedin and company — rather than a guessed email.
                </span>
              </li>
              <li className="flex gap-2.5">
                <Icon name="check" className="mt-0.5 size-3.5 shrink-0 text-green" />
                <span>
                  <span className="text-ink-2">imported people are real leads.</span> they land with the source you chose,
                  an entry in their timeline, and count in every number on your dashboard.
                </span>
              </li>
            </ul>
          </Card>

          <Card>
            <CardHeader title="the numbers" />
            <div className="mt-1.5">
              <KeyValue label="leads attributed">
                <span className="num">{totalLeads}</span>
              </KeyValue>
              <KeyValue label="sources connected">
                <span className="num">{sources.length}</span>
              </KeyValue>
              <KeyValue label="waiting in the inbox">
                <span className="num">{recent.total}</span>
              </KeyValue>
              <KeyValue label="providers connected">
                <span className="num">{connected.length}</span>
              </KeyValue>
            </div>
            <div className="mt-3 space-y-1.5 border-t border-line pt-2.5">
              <p className="text-[11.5px] font-medium text-muted">other ways in</p>
              <div className="flex flex-wrap gap-1.5">
                <Link href="/sources?tab=forms" className="inline-flex">
                  <Badge tone="violet" size="xs">
                    put a form on your site
                  </Badge>
                </Link>
                <Link href="/sources?tab=imports" className="inline-flex">
                  <Badge tone="slate" size="xs">
                    upload a csv
                  </Badge>
                </Link>
                <Link href="/sources" className="inline-flex">
                  <Badge tone="blue" size="xs">
                    connect a platform
                  </Badge>
                </Link>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

const SENIORITY = [
  { value: "owner", label: "owner" },
  { value: "founder", label: "founder" },
  { value: "c_suite", label: "c-suite" },
  { value: "partner", label: "partner" },
  { value: "vp", label: "vp" },
  { value: "head", label: "head of" },
  { value: "director", label: "director" },
  { value: "manager", label: "manager" },
  { value: "senior", label: "senior" },
];

const SIZES = [
  { value: "1,10", label: "1–10" },
  { value: "11,20", label: "11–20" },
  { value: "21,50", label: "21–50" },
  { value: "51,100", label: "51–100" },
  { value: "101,200", label: "101–200" },
  { value: "201,500", label: "201–500" },
  { value: "501,1000", label: "501–1,000" },
  { value: "1001,2000", label: "1,001–2,000" },
  { value: "2001,5000", label: "2,001–5,000" },
  { value: "5001,10000", label: "5,001–10,000" },
  { value: "10001,", label: "10,000+" },
];