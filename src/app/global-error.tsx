"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html>
      <body>
        <div style={{ maxWidth: 480, margin: "64px auto", textAlign: "center", fontFamily: "system-ui" }}>
          <p style={{ fontSize: 14, fontWeight: 600 }}>something went wrong</p>
          <p style={{ fontSize: 13, color: "#666" }}>
            {process.env.NODE_ENV === "development" ? error.message : "please try again."}
          </p>
          <button onClick={() => reset()} style={{ marginTop: 16, padding: "6px 12px" }}>
            try again
          </button>
        </div>
      </body>
    </html>
  );
}
