import Link from "next/link";
import { db } from "@/lib/db/client";
import { requireWorkspaceId } from "@/lib/workspace";
import { humanize } from "@/lib/db/time";
import { listForms, listImports, listSources } from "@/lib/queries/sources";
import { sourcePerformance } from "@/lib/queries/analytics";
import { SOURCE_KIND_META } from "@/lib/domain";
import { Badge, Card, CardHeader, EmptyState, Icon, KeyValue } from "@/components/ui";
import { BarRow } from "@/components/charts";
import { PageHeader, Tabs } from "@/components/app-shell";
import { NewSourceButton, SourceActions } from "@/components/source-actions";
import { NewFormButton } from "@/components/new-form";
import { CsvImporter } from "@/components/csv-importer";

export const dynamic = "force-dynamic";

const TABS = ["sources", "forms", "imports", "attribution"] as const;
type Tab = (typeof TABS)[number];

const STATUS_TONE: Record<string, "green" | "amber" | "slate" | "rose"> = {
  connected: "green",
  live: "green",
  needs_attention: "amber",
  paused: "slate",
  disconnected: "rose",
  archived: "slate",
};

const IMPORT_TONE: Record<string, "green" | "amber" | "slate" | "rose"> = {
  completed: "green",
  processing: "amber",
  pending: "slate",
  failed: "rose",
};

export default async function SourcesPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const params = await searchParams;
  const tab = (TABS as readonly string[]).includes(params.tab ?? "") ? (params.tab as Tab) : "sources";

  const database = db();
  const workspaceId = requireWorkspaceId(database);

  const sources = listSources(workspaceId, database);
  const forms = listForms(workspaceId, database);
  const imports = listImports(workspaceId, database);
  const performance = sourcePerformance(workspaceId, database);

  const pick = sources.map((s) => ({ id: s.id, name: s.name }));

  const tabs = [
    { label: "sources", value: "sources", count: sources.length },
    { label: "forms", value: "forms", count: forms.length },
    { label: "imports", value: "imports", count: imports.length },
    { label: "attribution", value: "attribution" },
  ];

  return (
    <div>
      <PageHeader
        title="lead sources"
        hint="everywhere leads come from — the platforms you connect, the forms on your site, the lists you upload, and how each of them actually performs."
        actions={
          tab === "sources" ? (
            <NewSourceButton />
          ) : tab === "forms" ? (
            <NewFormButton sources={pick} />
          ) : undefined
        }
        tabs={<Tabs items={tabs} active={tab} basePath="/sources" />}
      />

      {tab === "sources" ? <SourcesView sources={sources} /> : null}
      {tab === "forms" ? <FormsView forms={forms} /> : null}
      {tab === "imports" ? <ImportsView imports={imports} sources={pick} /> : null}
      {tab === "attribution" ? <AttributionView performance={performance} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------- sources

function SourcesView({ sources }: { sources: ReturnType<typeof listSources> }) {
  if (!sources.length) {
    return (
      <Card className="mt-4" padded={false}>
        <EmptyState
          title="nothing connected yet"
          hint="a source is just a label for where your leads come from. add one and start crediting it."
          icon={<Icon name="sources" className="size-5" />}
        />
      </Card>
    );
  }

  return (
    <div className="mt-4 space-y-3">
      <p className="max-w-3xl text-[12.5px] leading-relaxed text-muted">
        each source syncs on its own in the background. we never hold anyone&rsquo;s password here — you connect the platform
        on their side and we just ask it for new people.
      </p>

      {sources.map((source) => {
        const kind = SOURCE_KIND_META[source.kind] ?? SOURCE_KIND_META.manual;
        const rate = source.lead_count ? Math.round((source.converted_count / source.lead_count) * 100) : 0;

        return (
          <Card key={source.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-[13.5px] font-semibold tracking-[-0.01em] text-ink">{source.name}</h2>
                  <Badge tone={kind.tone} size="xs" title={kind.hint}>
                    {kind.label}
                  </Badge>
                  <Badge tone={STATUS_TONE[source.status] ?? "slate"} size="xs" dot>
                    {source.status.replace("_", " ")}
                  </Badge>
                </div>
                {source.notes ? <p className="mt-1 text-[12px] text-muted">{source.notes}</p> : null}
              </div>
              <SourceActions sourceId={source.id} status={source.status} />
            </div>

            <div className="mt-3 grid gap-x-8 border-t border-line pt-2 sm:grid-cols-2 lg:grid-cols-4">
              <KeyValue label="leads from here">
                <span className="num">{source.lead_count}</span>
              </KeyValue>
              <KeyValue label="converted">
                <span className="num">{source.converted_count}</span> <span className="text-faint">({rate}%)</span>
              </KeyValue>
              <KeyValue label="last sync">{source.last_sync_at ? humanize(source.last_sync_at) : "never"}</KeyValue>
              <KeyValue label="syncs every">
                {source.sync_cadence_hours >= 24
                  ? `${Math.round(source.sync_cadence_hours / 24)} ${Math.round(source.sync_cadence_hours / 24) === 1 ? "day" : "days"}`
                  : `${source.sync_cadence_hours} ${source.sync_cadence_hours === 1 ? "hour" : "hours"}`}
              </KeyValue>
            </div>

            <div className="mt-2 flex gap-4 text-[11.5px]">
              <Link href={`/leads?source=${encodeURIComponent(source.name)}`} className="text-accent-ink hover:underline">
                see everyone from this source
              </Link>
              <Link href="/sources?tab=attribution" className="text-accent-ink hover:underline">
                how it is doing
              </Link>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- forms

function FormsView({ forms }: { forms: ReturnType<typeof listForms> }) {
  return (
    <div className="mt-4 space-y-4">
      <Card>
        <CardHeader title="what these are" hint="a form on your site that drops people straight into your workspace" />
        <p className="mt-2.5 text-[12.5px] leading-relaxed text-muted">
          every form gets its own link. put it behind a button, or drop the whole page on your site. whoever fills it in lands
          in the inbox as a new lead, already tagged with the source you picked — no copying and pasting, no csv.
        </p>
      </Card>

      <Card padded={false}>
        {forms.length === 0 ? (
          <EmptyState
            title="no forms yet"
            hint="make one and you get a link straight away to point at."
            icon={<Icon name="mail" className="size-5" />}
          />
        ) : (
          <ul className="divide-y divide-line">
            {forms.map((form) => (
              <li key={form.id} className="px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[12.5px] font-medium text-ink">{form.name}</span>
                      <Badge tone={STATUS_TONE[form.status] ?? "slate"} size="xs" dot>
                        {form.status}
                      </Badge>
                    </div>
                    <p className="mt-0.5 truncate text-[11.5px] text-muted">
                      <span className="text-faint">/f/</span>
                      {form.slug}
                      {form.source_name ? <span className="text-faint"> · counted as {form.source_name}</span> : null}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="text-[11.5px] text-muted">
                      <span className="num text-ink">{form.submit_count}</span> submitted
                    </span>
                    <Link href={`/f/${form.slug}`} className="text-[11.5px] text-accent-ink hover:underline">
                      open it
                    </Link>
                  </div>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <code className="rounded-[5px] bg-surface-2 px-1.5 py-0.5 font-mono text-[10.5px] text-muted">/f/{form.slug}</code>
                  <span className="text-[11px] text-faint">copy that path onto any page</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- imports

function ImportsView({ imports, sources }: { imports: ReturnType<typeof listImports>; sources: Array<{ id: string; name: string }> }) {
  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-5">
      <div className="space-y-4 lg:col-span-3">
        <Card>
          <CardHeader title="import a csv" hint="paste it or pick a file. we match on email, so people you already have do not get added twice." />
          <div className="mt-3">
            <CsvImporter sources={sources} />
          </div>
        </Card>

        <Card>
          <CardHeader title="what a csv needs" hint="nothing fancy" />
          <ul className="mt-2.5 space-y-1.5 text-[12.5px] leading-relaxed text-muted">
            <li>
              <span className="text-ink-2">a header line.</span> something like{" "}
              <code className="font-mono text-[11.5px]">name, email, company, title</code>. we are not fussy about capital letters
              and we understand &ldquo;full name&rdquo; and &ldquo;job title&rdquo; too.
            </li>
            <li>
              <span className="text-ink-2">a name or an email on every row.</span> rows with neither are skipped and counted.
            </li>
            <li>
              <span className="text-ink-2">quotes are fine.</span> if a cell has a comma inside it, wrap it in double quotes and
              we will sort it out.
            </li>
          </ul>
        </Card>
      </div>

      <Card className="lg:col-span-2" padded={false}>
        <div className="border-b border-line px-4 py-3">
          <h2 className="text-[13.5px] font-semibold tracking-[-0.01em]">past imports</h2>
          <p className="mt-0.5 text-[12px] text-muted">the last fifty, newest first</p>
        </div>

        {imports.length === 0 ? (
          <EmptyState title="nothing imported yet" hint="your first upload will show up here with the numbers." />
        ) : (
          <ul className="divide-y divide-line">
            {imports.map((row) => (
              <li key={row.id} className="px-4 py-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <span className="block truncate text-[12.5px] text-ink">{row.name}</span>
                    <span className="mt-0.5 block truncate text-[11px] text-muted">
                      {humanize(row.created_at)}
                      {row.source_name ? ` · ${row.source_name}` : ""}
                    </span>
                  </div>
                  <Badge tone={IMPORT_TONE[row.status] ?? "slate"} size="xs" dot>
                    {row.status}
                  </Badge>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted">
                  <span>
                    <span className="num text-ink">{row.imported_rows}</span> added
                  </span>
                  <span>
                    <span className="num text-ink">{row.merged_rows}</span> already known
                  </span>
                  <span>
                    <span className="num text-ink">{row.skipped_rows}</span> skipped
                  </span>
                  {row.error_count ? (
                    <span className="text-rose">
                      <span className="num">{row.error_count}</span> could not be read
                    </span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- attribution

function AttributionView({ performance }: { performance: ReturnType<typeof sourcePerformance> }) {
  const max = Math.max(...performance.map((p) => p.total), 1);

  return (
    <div className="mt-4 space-y-4">
      <Card>
        <CardHeader title="where leads actually come from" hint="sorted by how many people each source has brought in" />
        {performance.length === 0 ? (
          <EmptyState title="no attribution yet" hint="once leads start arriving we will show which sources earned them." />
        ) : (
          <div className="mt-4 space-y-2.5">
            {performance.map((row) => {
              const kind = SOURCE_KIND_META[row.kind as keyof typeof SOURCE_KIND_META];
              return (
                <BarRow
                  key={row.id}
                  label={
                    <span className="flex items-center gap-1.5">
                      <span className="truncate">{row.name}</span>
                      {kind ? (
                        <Badge tone={kind.tone} size="xs">
                          {kind.label}
                        </Badge>
                      ) : null}
                    </span>
                  }
                  value={row.total}
                  max={max}
                  tone={`var(--${toneVar(row.kind)})`}
                  right={
                    <>
                      <span className="num text-ink">{row.total}</span>
                      <span className="ml-1.5 text-faint">{row.conversionRate}% convert</span>
                    </>
                  }
                />
              );
            })}
          </div>
        )}
      </Card>

      <Card padded={false}>
        <div className="border-b border-line px-4 py-3">
          <h2 className="text-[13.5px] font-semibold tracking-[-0.01em]">the full picture</h2>
          <p className="mt-0.5 text-[12px] text-muted">every source, side by side</p>
        </div>

        {performance.length === 0 ? (
          <EmptyState title="nothing to compare yet" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left">
              <thead>
                <tr className="border-b border-line bg-surface-2/50">
                  <th className="px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-faint">source</th>
                  <th className="px-3 py-2 text-right text-[11px] font-medium uppercase tracking-wide text-faint">leads</th>
                  <th className="px-3 py-2 text-right text-[11px] font-medium uppercase tracking-wide text-faint">replied</th>
                  <th className="px-3 py-2 text-right text-[11px] font-medium uppercase tracking-wide text-faint">qualified</th>
                  <th className="px-3 py-2 text-right text-[11px] font-medium uppercase tracking-wide text-faint">converted</th>
                  <th className="px-3 py-2 text-right text-[11px] font-medium uppercase tracking-wide text-faint">reply rate</th>
                  <th className="px-4 py-2 text-right text-[11px] font-medium uppercase tracking-wide text-faint">conversion</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {performance.map((row) => (
                  <tr key={row.id} className="transition-colors hover:bg-surface-2/40">
                    <td className="px-4 py-2.5">
                      <Link href={`/leads?source=${encodeURIComponent(row.name)}`} className="text-[12.5px] text-ink hover:underline">
                        {row.name}
                      </Link>
                    </td>
                    <td className="num px-3 py-2.5 text-right text-[12.5px] text-ink">{row.total}</td>
                    <td className="num px-3 py-2.5 text-right text-[12.5px] text-muted">{row.replied}</td>
                    <td className="num px-3 py-2.5 text-right text-[12.5px] text-muted">{row.qualified}</td>
                    <td className="num px-3 py-2.5 text-right text-[12.5px] text-muted">{row.converted}</td>
                    <td className="num px-3 py-2.5 text-right text-[12.5px] text-muted">{row.replyRate}%</td>
                    <td className="num px-4 py-2.5 text-right text-[12.5px] text-ink">{row.conversionRate}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <div className="flex items-start gap-2.5">
          <Icon name="alert" className="mt-0.5 size-4 shrink-0 text-faint" />
          <p className="text-[12.5px] leading-relaxed text-muted">
            <span className="font-medium text-ink-2">worth knowing:</span> a lead that arrives from two sources is counted once
            in the total number of leads, but credited to both of those sources. so the totals here add up to more than the
            number of people you have — that is on purpose, and it keeps every source honest.
          </p>
        </div>
      </Card>
    </div>
  );
}

function toneVar(kind: string): string {
  const meta = SOURCE_KIND_META[kind as keyof typeof SOURCE_KIND_META];
  return meta?.tone === "stone" ? "stone" : (meta?.tone ?? "accent");
}