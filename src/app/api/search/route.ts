import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { getWorkspaceRow } from "@/lib/workspace";

export const dynamic = "force-dynamic";

/** quick lead lookup for the search box and the lead picker. */
export async function GET(request: Request) {
  const workspace = getWorkspaceRow(db());
  if (!workspace) return NextResponse.json({ hits: [] });

  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").trim().toLowerCase();
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 8) || 8, 25);

  if (query.length < 1) return NextResponse.json({ hits: [] });

  const like = `%${query}%`;
  const rows = db()
    .prepare(
      `SELECT l.id, l.full_name, l.email, l.job_title, l.pipeline_stage, l.company_id, c.name AS company_name
       FROM leads l
       LEFT JOIN companies c ON c.id = l.company_id
       WHERE l.workspace_id = ?
         AND l.merged_into_lead_id IS NULL
         AND l.is_archived = 0
         AND (
           lower(l.full_name) LIKE ?
           OR lower(l.email) LIKE ?
           OR lower(c.name) LIKE ?
           OR lower(l.job_title) LIKE ?
           OR lower(l.phone_normalized) LIKE ?
           OR lower(l.id) = ?
         )
       ORDER BY
         CASE
           WHEN lower(l.full_name) = ? THEN 0
           WHEN lower(l.email_normalized) = ? THEN 1
           WHEN lower(l.full_name) LIKE ? THEN 2
           ELSE 3
         END,
         l.created_at DESC
       LIMIT ?`,
    )
    .all(
      workspace.id,
      like,
      like,
      like,
      like,
      like,
      query,
      query,
      query,
      like,
      limit,
    ) as Array<{
    id: string;
    full_name: string;
    email: string | null;
    job_title: string | null;
    pipeline_stage: string;
    company_name: string | null;
  }>;

  return NextResponse.json({
    hits: rows.map((r) => ({
      id: r.id,
      full_name: r.full_name,
      email: r.email,
      job_title: r.job_title,
      company_name: r.company_name,
      pipeline_stage: r.pipeline_stage,
    })),
  });
}