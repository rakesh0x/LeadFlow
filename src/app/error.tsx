"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const isDev = process.env.NODE_ENV === "development";
  return (
    <div className="mx-auto max-w-lg px-4 py-16 text-center">
      <p className="text-[13px] font-medium text-ink">something went wrong</p>
      <p className="mt-1 text-[12.5px] text-muted">
        {isDev ? error.message : "please try again — if this keeps happening, check the logs."}
      </p>
      {error.digest ? <p className="mt-1 text-[11px] text-faint">ref: {error.digest}</p> : null}
      <button
        onClick={() => reset()}
        className="mt-4 rounded-[7px] border border-line bg-surface px-3 py-1.5 text-[12.5px] text-ink hover:bg-surface-2"
      >
        try again
      </button>
    </div>
  );
}
