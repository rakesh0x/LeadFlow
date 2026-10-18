import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { getWorkspaceRow } from "@/lib/workspace";
import { getForm } from "@/lib/queries/sources";
import { submitFormAction } from "@/app/actions";

export const dynamic = "force-dynamic";

/**
 * plain http capture endpoint, so a form on any website can post here without
 * needing the next.js runtime:
 *
 *   curl -X POST https://your-host/api/submit/book-a-demo \
 *        -d 'full_name=jane doe' -d 'email=jane@acme.com' -d 'company_name=acme'
 *
 * accepts urlencoded posts, multipart form posts and json, so it works from a
 * plain <form> on a site you do not control.
 */
async function handle(request: Request, slug: string) {
  const database = db();
  const workspace = getWorkspaceRow(database);
  if (!workspace) return NextResponse.json({ ok: false, error: "no workspace" }, { status: 503 });

  const form = getForm(workspace.id, slug, database);
  if (!form || form.status !== "live") {
    return NextResponse.json({ ok: false, error: "this form is not accepting submissions" }, { status: 404 });
  }

  const contentType = request.headers.get("content-type") ?? "";
  let values: Record<string, string> = {};

  if (contentType.includes("application/json")) {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    for (const [key, value] of Object.entries(body)) values[key] = String(value ?? "");
  } else {
    const formData = await request.formData();
    for (const [key, value] of formData.entries()) {
      if (typeof value === "string") values[key] = value;
    }
  }

  // a honeypot field that only a bot would fill in
  if (values["website_url"] || values["_gotcha"]) {
    return NextResponse.json({ ok: true, message: "thanks" });
  }

  if (!values["full_name"]?.trim() && !values["email"]?.trim()) {
    return NextResponse.json({ ok: false, error: "a name or an email is required" }, { status: 400 });
  }

  const result = await submitFormAction(slug, values);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error ?? "could not save this" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, leadId: result.id });
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return handle(request, slug);
}

export async function PUT(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return handle(request, slug);
}