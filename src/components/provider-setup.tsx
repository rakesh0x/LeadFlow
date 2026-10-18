"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, CardHeader, Icon } from "./ui";
import { saveDiscoveryKey, removeDiscoveryKey, verifyDiscoveryKey, type DiscoveryResult } from "@/app/discovery-actions";

export interface ProviderCardData {
  id: string;
  info: {
    id: string;
    label: string;
    kinds: string[];
    providesEmailOnSearch: boolean;
    emailMethod: string;
    signupUrl: string;
    docsUrl: string;
    keyUrl: string;
    planNotes: string[];
    sizeFilterLabel: string;
    companiesNote?: string;
  };
  status: {
    provider: string;
    label: string;
    configured: boolean;
    source: "environment" | "database" | "none";
    hint: string | null;
    plan: string | null;
    lastVerifiedAt: string | null;
    lastError: string | null;
  } | null;
}

function ResultNote({ result }: { result: DiscoveryResult | null }) {
  if (!result) return null;
  if (!result.ok) {
    return (
      <div className="mt-3 rounded-[9px] border border-rose/30 bg-rose-soft px-3 py-2.5">
        <p className="text-[12.5px] font-medium text-rose">{result.error}</p>
        {result.detail ? <p className="mt-1 text-[11.5px] text-rose/80">{result.detail}</p> : null}
        {result.message ? <p className="mt-1 text-[11.5px] text-muted">{result.message}</p> : null}
      </div>
    );
  }
  if (!result.message) return null;
  return (
    <div className="mt-3 rounded-[9px] bg-green-soft px-3 py-2.5">
      <p className="text-[12.5px] font-medium text-green">{result.message}</p>
    </div>
  );
}

/**
 * the honest path when no key is present: say exactly what to do, with the links,
 * and never show a made-up person in its place.
 */
export function ProviderSetup({ providers }: { providers: ProviderCardData[] }) {
  const [selected, setSelected] = useState(providers[0]?.id ?? "apollo");
  const [apiKey, setApiKey] = useState("");
  const [plan, setPlan] = useState<"free" | "pro">("free");
  const [result, setResult] = useState<DiscoveryResult | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const active = providers.find((p) => p.id === selected) ?? providers[0];

  const submit = () => {
    setResult(null);
    startTransition(async () => {
      const outcome = await saveDiscoveryKey({ provider: selected, apiKey, plan });
      setResult(outcome);
      if (outcome.ok) setApiKey("");
      router.refresh();
    });
  };

  return (
    <Card>
      <CardHeader
        title="connect a data provider"
        hint="real people come from a real database. nothing here is made up, which is why it needs an api key before it can search."
        icon={<Icon name="settings" className="size-4" />}
      />

      <div className="mt-4 flex flex-wrap gap-1.5">
        {providers.map((p) => (
          <button
            key={p.id}
            onClick={() => setSelected(p.id)}
            className={`rounded-[7px] border px-2.5 py-1.5 text-[12.5px] transition-colors ${
              selected === p.id ? "border-accent bg-accent-soft font-medium text-accent-ink" : "border-line text-muted hover:text-ink"
            }`}
          >
            {p.info.label}
            {p.status?.configured ? <span className="ml-1.5 text-green">· connected</span> : null}
          </button>
        ))}
      </div>

      {active ? (
        <div className="mt-4 space-y-3">
          <p className="text-[12.5px] leading-relaxed text-muted">{active.info.emailMethod}</p>

          <ul className="space-y-1.5">
            {active.info.planNotes.map((note) => (
              <li key={note} className="flex gap-2 text-[12px] leading-relaxed text-muted">
                <span className="mt-[7px] size-1 shrink-0 rounded-full bg-faint" />
                {note}
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap gap-2 pt-1">
            <a
              href={active.info.signupUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="text-[12px] text-accent-ink hover:underline"
            >
              get an account →
            </a>
            <a href={active.info.docsUrl} target="_blank" rel="noreferrer noopener" className="text-[12px] text-accent-ink hover:underline">
              read the api docs →
            </a>
            <a href={active.info.keyUrl} target="_blank" rel="noreferrer noopener" className="text-[12px] text-accent-ink hover:underline">
              find your api key →
            </a>
          </div>

          <Divider />

          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <label className="block">
              <span className="mb-1 block text-[11.5px] font-medium text-muted">
                api key {active.status?.source === "environment" ? "(set in the environment — this form is ignored)" : ""}
              </span>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="paste the key"
                autoComplete="off"
                spellCheck={false}
                className="field font-mono text-[12px]"
                disabled={active.status?.source === "environment"}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11.5px] font-medium text-muted">plan</span>
              <select value={plan} onChange={(e) => setPlan(e.target.value as "free" | "pro")} className="field">
                <option value="free">free</option>
                <option value="pro">paid</option>
              </select>
            </label>
          </div>

          {active.status?.source === "environment" ? (
            <p className="text-[11.5px] text-muted">
              this workspace reads the key from an environment variable, so it never touches the database.
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" size="sm" onClick={submit} disabled={pending || !apiKey.trim() || active.status?.source === "environment"}>
              {pending ? "checking…" : "connect and verify"}
            </Button>
            {active.status?.configured && active.status.source === "database" ? (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      setResult(await verifyDiscoveryKey(selected));
                      router.refresh();
                    })
                  }
                >
                  test connection
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      setResult(await removeDiscoveryKey(selected));
                      router.refresh();
                    })
                  }
                >
                  remove key
                </Button>
              </>
            ) : null}
            {active.status?.hint ? <span className="font-mono text-[11px] text-faint">saved as {active.status.hint}</span> : null}
          </div>

          <ResultNote result={result} />

          <p className="text-[11px] leading-relaxed text-faint">
            keys are encrypted before they are stored and are never shown again. you can also set them in the environment
            with <span className="font-mono">leadflow_apollo_api_key</span> or <span className="font-mono">leadflow_pdl_api_key</span>.
          </p>
        </div>
      ) : null}
    </Card>
  );
}

export function ConnectionBadge({ status }: { status: ProviderCardData["status"] }) {
  if (!status) return <Badge tone="slate">not connected</Badge>;
  if (!status.configured) return <Badge tone="slate" dot>not connected</Badge>;
  return (
    <Badge tone="green" dot>
      connected{status.plan ? ` · ${status.plan}` : ""}
      {status.source === "environment" ? " · env" : ""}
    </Badge>
  );
}

function Divider() {
  return <div className="h-px w-full bg-line" />;
}

export function SetupShell({ children }: { children: ReactNode }) {
  return <div className="space-y-3">{children}</div>;
}