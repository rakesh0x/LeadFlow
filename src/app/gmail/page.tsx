"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { getGmailMessagesList, getLeadEmails, syncGmail, getGmailAccounts } from "@/app/gmail-actions";
import { Badge, Button, Card, CardHeader, EmptyState, Icon, Avatar, Link } from "./ui";
import { humanize } from "@/lib/db/time";
import { formatDateTime } from "@/lib/db/time";
import { PageHeader } from "@/components/app-shell";

interface GmailMessage {
  id: string;
  subject: string | null;
  from_email: string;
  from_name: string | null;
  to_emails_json: string;
  snippet: string | null;
  direction: "inbound" | "outbound";
  is_read: number;
  gmail_sent_at: string | null;
  gmail_received_at: string | null;
  lead_id: string | null;
  lead_name: string | null;
  lead_email: string | null;
  lead_pipeline_stage: string | null;
}

interface GmailAccount {
  id: string;
  email: string;
  status: string;
  last_sync_at: string | null;
  is_default: number;
}

export function GmailInbox() {
  const [view, setView] = useState<"awaiting" | "no-reply" | "all" | "unread">("awaiting");
  const [messages, setMessages] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [selectedAccount, setSelectedAccount] = useState<string>("all");
  const router = useRouter();

  const views = [
    { value: "awaiting", label: "awaiting reply" },
    { value: "no-reply", label: "no reply" },
    { value: "unread", label: "unread" },
    { value: "all", label: "all messages" },
  ];

  const fetchMessages = async () => {
    setLoading(true);
    try {
      const result = await getGmailMessagesList({
        view: selectedAccount === "all" ? undefined : selectedAccount,
        direction: view === "awaiting" ? "inbound" : view === "no-reply" ? "outbound" : undefined,
        isRead: view === "unread" ? false : undefined,
        limit: 50,
      });
      setMessages(result.messages);
      setTotal(result.total);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const fetchAccounts = async () => {
    const accounts = await getGmailAccounts();
    setAccounts(accounts.filter((a: any) => a.status === "connected"));
  };

  useEffect(() => {
    fetchAccounts();
  }, []);

  useEffect(() => {
    fetchMessages();
  }, [view, selectedAccount]);

  const handleSync = async () => {
    const { syncAllGmail } = await import("@/app/gmail-actions");
    await syncAllGmail();
    fetchMessages();
  };

  const openMessage = (msg: any) => {
    if (msg.lead_id) {
      router.push(`/leads/${msg.lead_id}?tab=messages`);
    }
  };

  const getDirectionBadge = (msg: any) => {
    if (msg.direction === "inbound") {
      return <Badge tone="green" size="xs">← inbound</Badge>;
    }
    return <Badge tone="blue" size="xs">→ outbound</Badge>;
  };

  const getReadBadge = (msg: any) => {
    if (!msg.is_read) {
      return <Badge tone="amber" size="xs">unread</Badge>;
    }
    return null;
  };

  const formatTime = (dateStr: string | null) => {
    if (!dateStr) return "—";
    return humanize(dateStr);
  };

  const views = [
    { value: "awaiting", label: "awaiting reply" },
    { value: "no-reply", label: "no reply" },
    { value: "unread", label: "unread" },
    { value: "all", label: "all messages" },
  ];

  return (
    <>
      <PageHeader
        title="gmail inbox"
        hint="replies waiting on you, emails you sent that need a reply, and everything else"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 rounded-[8px] border border-line bg-surface p-0.5">
              {views.map((v) => (
                <button
                  key={v.value}
                  onClick={() => setView(v.value as any)}
                  className={`rounded-[6px] px-2 py-1 text-[12px] transition-colors ${
                    view === v.value ? "bg-accent-soft font-medium text-accent-ink" : "text-muted hover:text-ink"
                  }`}
                >
                  {v.label}
                </button>
              ))}
            </div>
            <Button variant="secondary" size="sm" onClick={async () => { const { syncAllGmail } = await import("@/app/gmail-actions"); await syncAllGmail(); window.location.reload(); }}>
              <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" /></svg>
              sync now
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card padded={false}>
            {loading ? (
              <div className="px-4 py-8 text-center text-[12.5px] text-muted">loading messages…</div>
            ) : messages.length === 0 ? (
              <EmptyState
                title={view === "awaiting" ? "nothing awaiting a reply" : view === "no-reply" ? "everything has a reply" : "no messages yet"}
                hint={view === "awaiting" ? "all caught up. good time to send some emails." : "sync gmail to see your messages here."}
                icon={<svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5.5" width="18" height="13" rx="2" /><path d="m3.8 7 8.2 5.6L20.2 7" /></svg>}
              />
            ) : (
              <div className="divide-y divide-line">
                {messages.map((msg) => (
                  <button
                    key={msg.id}
                    onClick={() => openMessage(msg)}
                    className="flex flex-wrap items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2/50 group"
                  >
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <svg className="size-5 shrink-0 text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5.5" width="18" height="13" rx="2" /><path d="m3.8 7 8.2 5.6L20.2 7" /></svg>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                          <span className={`truncate ${!msg.is_read ? "font-medium text-ink" : "text-ink-2"}`}>{msg.subject ?? "(no subject)"}</span>
                          {getDirectionBadge(msg)}
                          {getReadBadge(msg)}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted">
                          <span className="truncate">{msg.from_name ?? msg.from_email}</span>
                          <span>·</span>
                          <span>{msg.lead_name ? `· ${msg.lead_name}` : ""}</span>
                          <span>{msg.lead_email ? `· ${msg.lead_email}` : ""}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 shrink-0 ml-auto">
                      <span className="text-[11px] text-faint">{msg.gmail_sent_at ? formatDateTime(msg.gmail_sent_at) : msg.gmail_received_at ? formatDateTime(msg.gmail_received_at) : "—"}</span>
                      {msg.lead_id && (
                        <Badge tone="slate" size="xs">
                          {msg.lead_pipeline_stage?.replaceAll("_", " ") ?? "lead"}
                        </Badge>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="accounts" hint="connected gmail accounts" />
            <ul className="mt-3 space-y-2">
              {accounts.length === 0 ? (
                <li className="text-center py-4 text-[12.5px] text-muted">no accounts connected yet</li>
              ) : (
                accounts.map((acc: any) => (
                  <li key={acc.id} className="flex items-center justify-between gap-2 px-1 py-2 rounded-[7px] transition-colors hover:bg-surface-2">
                    <div className="flex items-center gap-2">
                      <svg className="size-5 shrink-0 text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5.5" width="18" height="13" rx="2" /><path d="m3.8 7 8.2 5.6L20.2 7" /></svg>
                      <div className="min-w-0">
                        <span className="block truncate text-[12.5px] text-ink">{acc.email}</span>
                        <span className="block text-[11px] text-muted">{acc.is_default ? "default" : ""}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone="blue" size="xs">{acc.status}</Badge>
                      <span className="text-[11px] text-faint">{acc.last_sync_at ? "last sync " + humanize(acc.last_sync_at) : "never synced"}</span>
                    </div>
                  </li>
                )))
            }
            </ul>
          </Card>

          <Card>
            <CardHeader title="quick actions" />
            <div className="mt-3 space-y-2">
              <Button variant="secondary" size="sm" className="w-full justify-start" onClick={async () => { const { syncAllGmail } = await import("@/app/gmail-actions"); await syncAllGmail(); window.location.reload(); }}>
                <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" /></svg>
                sync all accounts
              </Button>
              <Link href="/gmail/drafts" className="flex items-center gap-2 rounded-[7px] border border-line bg-surface px-2.5 py-1.5 text-[12.5px] text-ink hover:bg-surface-2">
                <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6.5 5.5 8 8 5.5" /><path d="M4 12.5 5.5 14 8 11.5" /><path d="M4 18.5 5.5 20 8 17.5" /><path d="M11 6h9M11 12h9M11 18h9" /></svg>
                drafts
              </Link>
              <Link href="/compose" className="flex items-center gap-2 rounded-[7px] border border-line bg-surface px-2.5 py-1.5 text-[12.5px] text-ink hover:bg-surface-2">
                <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h15A1.5 1.5 0 0 1 21 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5Z" /><path d="m3.5 7 8.5 6 8.5-6" /></svg>
                compose email
              </Link>
            </div>
          </Card>
        </div>
      </div>
    </>
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

function formatDateTime(dateStr: string | null): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" });
}

function getDirectionBadge(msg: any) {
  if (msg.direction === "inbound") {
    return <Badge tone="green" size="xs">← inbound</Badge>;
  }
  return <Badge tone="blue" size="xs">→ outbound</Badge>;
}

function getReadBadge(msg: any) {
  if (!msg.is_read) {
    return <Badge tone="amber" size="xs">unread</Badge>;
  }
  return null;
}

function formatDateTime(dateStr: string | null): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" });
}