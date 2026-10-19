"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { startGmailOAuth } from "@/app/gmail-actions";
import { Badge, Button, Card, CardHeader, Icon } from "./ui";

export function GmailProviderSetup({ statuses }: { statuses: Array<{ provider: string; label: string; configured: boolean; source: string; hint: string | null; plan: string | null; lastVerifiedAt: string | null; lastError: string | null }> }) {
  const [result, setResult] = useState<{ ok: boolean; error?: string; message?: string } | null>(null);
  const [pending, startTransitionAction] = useTransition();
  const router = useRouter();

  const gmailStatus = statuses.find((s) => s.provider === "gmail");
  const isConnected = gmailStatus?.configured ?? false;

  const connectGmail = () => {
    setResult(null);
    startTransitionAction(async () => {
      const { startGmailOAuth } = await import("@/app/gmail-actions");
      const result = await startGmailOAuth();
      if ("url" in result) {
        window.location.href = result.url;
      } else {
        setResult({ ok: false, error: result.error });
      }
    });
  };

  const handleDisconnect = async () => {
    const { disconnectGmail } = await import("@/app/gmail-actions");
    // Would need account ID - simplified for now
  };

  return (
    <Card>
      <CardHeader
        title="gmail"
        hint="sync your emails, track replies, and send from leadflow. uses google oauth — your password never touches our servers."
        icon={<svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5.5" width="18" height="13" rx="2" /><path d="m3.8 7 8.2 5.6L20.2 7" /></svg>}
      />

      <div className="mt-4 space-y-3">
        <p className="text-[12.5px] leading-relaxed text-muted">
          connect your gmail account to sync sent and received emails, match them to leads, and send emails from leadflow.
          we use google oauth — your password never leaves google.
        </p>

        <ul className="space-y-1.5 text-[12px] leading-relaxed text-muted">
          <li className="flex gap-2"><span className="mt-[7px] size-1 shrink-0 rounded-full bg-faint" />requires a google cloud project with gmail api enabled</li>
          <li className="flex gap-2"><span className="mt-[7px] size-1 shrink-0 rounded-full bg-faint" />oauth consent screen must have gmail.readonly, gmail.send, gmail.modify, gmail.metadata scopes</li>
          <li className="flex gap-2"><span className="mt-[7px] size-1 shrink-0 rounded-full bg-faint" />free tier: generous daily limits</li>
          <li className="flex gap-2"><span className="mt-[7px] size-1 shrink-0 rounded-full bg-faint" />tokens are encrypted and stored securely</li>
        </ul>

        <div className="flex flex-wrap gap-2 pt-1">
          <Button variant="primary" size="sm" onClick={connectGmail} disabled={false}>
            <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5.5" width="18" height="13" rx="2" /><path d="m3.8 7 8.2 5.6L20.2 7" /></svg>
            connect gmail
          </Button>
          <a href="https://console.cloud.google.com/" target="_blank" rel="noreferrer noopener" className="text-[12px] text-accent-ink hover:underline">create google cloud project →</a>
          <a href="https://developers.google.com/gmail/api" target="_blank" rel="noreferrer noopener" className="text-[12px] text-accent-ink hover:underline">read the api docs →</a>
        </div>
      </div>
    </Card>
  );
}

function connectGmail() {
  window.location.href = "/api/auth/gmail";
}