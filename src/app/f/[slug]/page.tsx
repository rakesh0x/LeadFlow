import { notFound } from "next/navigation";
import { db } from "@/lib/db/client";
import { requireWorkspaceId } from "@/lib/workspace";
import { getForm } from "@/lib/queries/sources";
import { FormSubmit } from "@/components/form-submit";

export const dynamic = "force-dynamic";

type FormField = { key: string; label: string; required?: boolean };

const FALLBACK: FormField[] = [
  { key: "full_name", label: "your name", required: true },
  { key: "email", label: "your email", required: true },
  { key: "company_name", label: "your company", required: false },
];

export default async function PublicFormPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const database = db();
  const workspaceId = requireWorkspaceId(database);
  const form = getForm(workspaceId, slug, database);

  if (!form) notFound();

  let fields: FormField[] = FALLBACK;
  try {
    const parsed = JSON.parse(form.fields_json || "[]") as FormField[];
    if (Array.isArray(parsed) && parsed.length) fields = parsed;
  } catch {
    fields = FALLBACK;
  }

  const open = form.status === "live";

  return (
    <div className="-mx-4 -my-5 flex min-h-[calc(100vh-40px)] items-center justify-center bg-canvas px-4 py-12 sm:-mx-6 sm:-my-6">
      <div className="panel w-full max-w-md overflow-hidden">
        {!open ? (
          <div className="px-6 py-14 text-center">
            <p className="text-[15px] font-medium text-ink">this form isn&rsquo;t open</p>
            <p className="mx-auto mt-2 max-w-xs text-[12.5px] leading-relaxed text-muted">
              it may have been paused or retired. if you were expecting something here, get in touch another way and we&rsquo;ll
              sort it out.
            </p>
          </div>
        ) : (
          <>
            <div className="border-b border-line px-6 py-6 text-center">
              <h1 className="text-[19px] font-semibold tracking-[-0.02em] text-ink">{form.name}</h1>
              <p className="mx-auto mt-1.5 max-w-xs text-[12.5px] leading-relaxed text-muted">
                fill this in and it lands straight with us. takes about twenty seconds.
              </p>
            </div>
            <FormSubmit slug={form.slug} name={form.name} fields={fields} />
          </>
        )}
      </div>
    </div>
  );
}