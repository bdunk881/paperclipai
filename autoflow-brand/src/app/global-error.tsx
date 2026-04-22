"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <main
          style={{
            minHeight: "100vh",
            display: "grid",
            placeItems: "center",
            padding: "2rem",
            background:
              "radial-gradient(circle at top right, rgba(20, 184, 166, 0.14), transparent 28%), linear-gradient(180deg, #0f172a 0%, #020617 100%)",
            color: "#f1f5f9",
            fontFamily: "Inter, sans-serif",
          }}
        >
          <div
            style={{
              width: "min(32rem, 100%)",
              padding: "2rem",
              borderRadius: "1.25rem",
              border: "1px solid rgba(148, 163, 184, 0.16)",
              background: "rgba(15, 23, 42, 0.86)",
            }}
          >
            <p
              style={{
                color: "#14b8a6",
                fontSize: "0.8rem",
                textTransform: "uppercase",
                letterSpacing: "0.16em",
                fontWeight: 800,
              }}
            >
              AutoFlow
            </p>
            <h1 style={{ marginTop: "1rem", fontSize: "2.4rem", lineHeight: 1, letterSpacing: "-0.05em" }}>
              Something went sideways.
            </h1>
            <p style={{ marginTop: "1rem", color: "#94a3b8", lineHeight: 1.7 }}>
              The page hit an unexpected state. Reset the session and try again.
            </p>
            {error.digest ? (
              <p style={{ marginTop: "0.75rem", color: "#64748b", fontSize: "0.92rem" }}>
                Error digest: {error.digest}
              </p>
            ) : null}
            <button
              type="button"
              onClick={reset}
              style={{
                marginTop: "1.5rem",
                padding: "0.9rem 1.2rem",
                border: "none",
                borderRadius: "0.9rem",
                background: "#14b8a6",
                color: "#020617",
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
