"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { getDraftsList, approveEmailDraft, rejectEmailDraft, sendApprovedDraft, deleteDraft } from "@/app/gmail-actions";
import { Badge, Button, Card, CardHeader, EmptyState } from "@/components/ui";
import { PageHeader } from "@/components/app-shell";

export default function DraftsPage() {
  const [drafts, setDrafts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");

  const fetchDrafts = async () => {
    setLoading(true);
    try {
      const result = await getDraftsList(filter === "all" ? {} : { status: filter });
      setDrafts(result);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDrafts();
  }, [filter]);

  const handleApprove = async (id: string) => {
    await approveEmailDraft(id);
    fetchDrafts();
  };

  const handleReject = async (id: string) => {
    await rejectEmailDraft(id);
    fetchDrafts();
  };

  const handleSend = async (id: string) => {
    await sendApprovedDraft(id);
    fetchDrafts();
  };

  const handleDelete = async (id: string) => {
    await deleteDraft(id);
    fetchDrafts();
  };

  return (
    <>
      <PageHeader
        title="email drafts"
        hint="review, approve and send drafts before they go out"
        actions={
          <Link href="/gmail/compose">
            <Button variant="primary" size="sm">compose</Button>
          </Link>
        }
      />
      <Card padded={false}>
        <div className="flex items-center gap-1 border-b border-line px-4 py-2">
          {["all", "draft", "approved", "sent", "rejected"].map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`rounded-[6px] px-2 py-1 text-[12px] ${filter === s ? "bg-accent-soft font-medium text-accent-ink" : "text-muted hover:text-ink"}`}
            >
              {s}
            </button>
          ))}
        </div>
        {loading ? (
          <div className="px-4 py-8 text-center text-[12.5px] text-muted">loading drafts…</div>
        ) : drafts.length === 0 ? (
          <EmptyState title="no drafts" hint="compose an email to get started." />
        ) : (
          <div className="divide-y divide-line">
            {drafts.map((d) => (
              <div key={d.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-[13px] text-ink">{d.subject ?? "(no subject)"}</span>
                  <Badge tone={d.status === "approved" ? "green" : d.status === "sent" ? "blue" : d.status === "rejected" ? "rose" : "slate"} size="xs">{d.status}</Badge>
                  {d.lead_name ? <span className="text-[11px] text-muted">→ {d.lead_name}</span> : null}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {d.status === "draft" ? <Button variant="primary" size="sm" onClick={() => handleApprove(d.id)}>approve</Button> : null}
                  {d.status === "approved" ? <Button variant="primary" size="sm" onClick={() => handleSend(d.id)}>send</Button> : null}
                  {d.status === "draft" || d.status === "rejected" ? <Button variant="secondary" size="sm" onClick={() => handleDelete(d.id)}>delete</Button> : null}
                  {d.status === "draft" ? <Button variant="secondary" size="sm" onClick={() => handleReject(d.id)}>reject</Button> : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}

