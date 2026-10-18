"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createEmailDraft, getGmailAccounts, getLeadEmails } from "@/app/gmail-actions";
import { Badge, Button, Card, CardHeader, EmptyState, Icon, Avatar } from "./ui";
import { humanize } from "@/lib/db/time";
import { PageHeader } from "@/components/app-shell";

interface Lead {
  id: string;
  full_name: string;
  email: string | null;
  job_title: string | null;
  company_name: string | null;
  pipeline_stage: string;
  outreach_state: string;
}

export function ComposePage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const leadId = searchParams.get("lead");
  
  const [accounts, setAccounts] = useState<any[]>([]);
  const [selectedAccount, setSelectedAccount] = useState("");
  const [to, setTo] = useState<Array<{ email: string; name?: string }>>([]);
  const [cc, setCc] = useState<Array<{ email: string; name?: string }>>([]);
  const [bcc, setBcc] = useState<Array<{ email: string; name?: string }>>([]);
  const [subject, setSubject] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [lead, setLead] = useState<Lead | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; error?: string; message?: string } | null>(null);

  useEffect(() => {
    fetchAccounts();
    if (leadId) fetchLead();
  }, [leadId]);

  const fetchAccounts = async () => {
    const accounts = await getGmailAccounts();
    setAccounts(accounts.filter((a: any) => a.status === "connected"));
  };

  const fetchLead = async () => {
    if (!leadId) return;
    try {
      const { getLeadEmails } = await import("@/app/gmail-actions");
      // We'll fetch lead data from the leads API
      const response = await fetch(`/api/leads/${leadId}`);
      if (response.ok) {
        const lead = await response.json();
        setLead(lead);
        if (lead.email) {
          setTo([{ email: lead.email, name: lead.full_name }]);
        }
      }
    } catch (error) {
      console.error(error);
    }
  };

  const addRecipient = (field: "to" | "cc" | "bcc", email: string, name?: string) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) return;
    const arr = field === "to" ? to : field === "cc" ? cc : bcc;
    if (arr.some((r) => r.email.toLowerCase() === email.toLowerCase())) return;
    const newRecipient = { email, name };
    if (field === "to") setTo([...to, { email, name }]);
    else if (field === "cc") setCc([...cc, { email, name }]);
    else setBcc([...bcc, { email, name }]);
  };

  const removeRecipient = (field: "to" | "cc" | "bcc", index: number) => {
    if (field === "to") setTo(to.filter((_, i) => i !== index));
    else if (field === "cc") setCc(cc.filter((_, i) => i !== index));
    else setBcc(bcc.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    if (!selectedAccount) return setMessage({ ok: false, error: "select a gmail account" });
    if (to.length === 0) return setMessage({ ok: false, error: "add at least one recipient" });

    setSaving(true);
    setMessage(null);
    try {
      const { createEmailDraft } = await import("@/app/gmail-actions");
      const result = await createEmailDraft({
        accountId: selectedAccount,
        leadId: leadId ?? undefined,
        to: to,
        cc: cc,
        bcc: bcc,
        subject: subject.trim() || "(no subject)",
        bodyText: bodyText,
        bodyHtml: bodyHtml,
      });
      if (result.ok) {
        setMessage({ ok: true, message: "draft saved" });
        setTimeout(() => router.push("/gmail/drafts"), 800);
      } else {
        setMessage({ ok: false, error: result.error });
      }
    } catch (error) {
      setMessage({ ok: false, error: error instanceof Error ? error.message : "failed to save" });
    } finally {
      setSaving(false);
    }
  };

  const recipientInput = (field: "to" | "cc" | "bcc", recipients: Array<{ email: string; name?: string }>, onAdd: (email: string, name?: string) => void) => {
    const [input, setInput] = useState("");
    const [showSuggestions, setShowSuggestions] = useState(false);

    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && input.trim()) {
        e.preventDefault();
        const [email, name] = input.trim().split(" ").filter(Boolean);
        onAdd(email, name);
        setInput("");
        setShowSuggestions(false);
      }
      if (e.key === "Escape") setShowSuggestions(false);
    };

    return (
      <div className="relative">
        <div className="flex flex-wrap gap-1.5 mb-1">
          {recipients.map((r, i) => (
            <span key={i} className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-1 text-[11.5px]">
              <span className="text-ink">{r.name ? `${r.name} <${r.email}>` : r.email}</span>
              <button type="button" onClick={() => {}} className="text-faint hover:text-rose">×</button>
            </span>
          ))}
        </div>
        <input
          type="email"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setShowSuggestions(true)}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
          placeholder="add email address…"
          className="field"
          autoComplete="off"
        />
      </div>
    );
  };

  return (
    <div>
      <PageHeader
        title={leadId ? "reply to lead" : "compose email"}
        hint="write your email, pick an account, and save as draft. you'll approve before sending."
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader title="from" hint="which gmail account to send from" />
            <div className="mt-3">
              <select
                value={selectedAccount}
                onChange={(e) => setSelectedAccount(e.target.value)}
                className="field w-full sm:w-64"
                disabled={accounts.length === 0}
              >
                <option value="">pick a gmail account</option>
                {accounts.map((a: any) => (
                  <option key={a.id} value={a.id} disabled={a.status !== "connected"}>
                    {a.email} {a.is_default ? "(default)" : ""} {a.status !== "connected" ? "— disconnected" : ""}
                  </option>
                ))}
              </select>
              {accounts.length === 0 && <p className="mt-1 text-[11.5px] text-faint">no gmail accounts connected. <a href="/settings?tab=integrations" className="link">connect one</a></p>}
            </div>
          </Card>

          <Card>
            <CardHeader title="to" hint="at least one recipient required" />
            <div className="mt-3 space-y-3">
              {recipientInput("to", to, (email, name) => setTo([...to, { email, name }]))}
              <div className="flex items-center gap-2 text-[11.5px] text-muted">
                <span>{to.length} recipient{to.length !== 1 ? "s" : ""}</span>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="cc / bcc" hint="optional carbon copy and blind carbon copy" />
            <div className="mt-3 space-y-3">
              {recipientInput("cc", cc, (email, name) => setCc([...cc, { email, name }]))}
              {recipientInput("bcc", bcc, (email, name) => setBcc([...bcc, { email, name }]))}
            </div>
          </Card>

          <Card>
            <CardHeader title="subject" />
            <div className="mt-3">
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="field w-full"
                placeholder="what's this about?"
              />
            </div>
          </Card>

          <Card>
            <CardHeader title="message" hint="write your email. html is supported." />
            <div className="mt-3 space-y-2">
              <div className="flex gap-1 rounded-[8px] border border-line bg-surface p-0.5">
                <button
                  type="button"
                  onClick={() => setBodyHtml("")}
                  className={`rounded-[6px] px-2.5 py-1 text-[12px] transition-colors ${bodyHtml ? "bg-surface font-medium text-ink shadow-xs" : "text-muted"}`}
                >
                  rich text
                </button>
                <button
                  type="button"
                  onClick={() => setBodyText("")}
                  className={`rounded-[6px] px-2.5 py-1 text-[12px] transition-colors ${bodyText && !bodyHtml ? "bg-surface font-medium text-ink shadow-xs" : "text-muted"}`}
                >
                  plain text
                </button>
              </div>
              {bodyHtml ? (
                <div className="rounded-[8px] border border-line bg-surface p-3 min-h-[200px]">
                  <div
                    contentEditable
                    suppressContentEditableWarning
                    onInput={(e) => setBodyHtml(e.currentTarget.innerHTML)}
                    className="min-h-[200px] prose prose-sm max-w-none focus:outline-none focus:ring-2 focus:ring-accent/20"
                    dangerouslySetInnerHTML={{ __html: bodyHtml }}
                  />
                </div>
              ) : (
                <textarea
                  value={bodyText}
                  onChange={(e) => setBodyText(e.target.value)}
                  rows={12}
                  className="field w-full font-mono resize-y"
                  placeholder="write your message here…"
                />
              )}
            </div>
          </Card>

          <div className="flex flex-wrap items-center gap-2 pt-2">
            <Button variant="secondary" size="sm" onClick={() => router.push("/gmail/drafts")}>
              <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6.5 5.5 8 8 5.5" /><path d="M4 12.5 5.5 14 8 11.5" /><path d="M4 18.5 5.5 20 8 17.5" /><path d="M11 6h9M11 12h9M11 18h9" /></svg>
              back to drafts
            </Button>
            <Button variant="primary" size="sm" onClick={handleSave} disabled={saving}>
              {saving ? "saving…" : "save draft"}
            </Button>
          </div>

          {message && (
            <div className={`rounded-[9px] px-3 py-2.5 ${message.ok ? "bg-green-soft text-green" : "border border-rose/30 bg-rose-soft text-rose"}`}>
              <p className="text-[12.5px] font-medium">{message.message ?? message.error}</p>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="lead context" hint={lead ? "this email will be linked to the lead" : "link a lead to track this conversation"} />
            <div className="mt-3">
              {lead ? (
                <Link href={`/leads/${lead.id}`} className="flex items-center gap-2 rounded-[7px] px-1.5 py-1.5 transition-colors hover:bg-surface-2">
                  <Avatar name={lead.full_name} size={28} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] text-ink">{lead.full_name}</span>
                    <span className="block truncate text-[11px] text-muted">{lead.job_title ?? "—"} {lead.company_name ? `at ${lead.company_name}` : ""}</span>
                  </span>
                  <Badge tone="slate" size="xs">{lead.pipeline_stage?.replaceAll("_", " ")}</Badge>
                  <Badge tone="blue" size="xs">{lead.outreach_state?.replaceAll("_", " ")}</Badge>
                </Link>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[12.5px] text-muted">no lead linked</span>
                  <a href="/leads" className="text-[12px] text-accent-ink hover:underline">browse leads →</a>
                </div>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="recent emails with this lead" hint="showing last 5 messages" />
            <div className="mt-3">
              <EmptyState
                title="no email history yet"
                hint="this will show sent and received emails once you sync gmail"
                icon={<svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5.5" width="18" height="13" rx="2" /><path d="m3.8 7 8.2 5.6L20.2 7" /></svg>}
              />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function humanize(dateStr: string | null): string {
  if (!dateStr) return "—";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}