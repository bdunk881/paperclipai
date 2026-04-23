import Link from "next/link";

export default function AppPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "2rem",
        background:
          "radial-gradient(circle at top right, rgba(99, 102, 241, 0.16), transparent 28%), linear-gradient(180deg, #0f172a 0%, #020617 100%)",
        color: "#f1f5f9",
        fontFamily: "Inter, sans-serif",
      }}
    >
      <section
        style={{
          width: "min(42rem, 100%)",
          padding: "2rem",
          borderRadius: "1.5rem",
          border: "1px solid rgba(148, 163, 184, 0.16)",
          background: "rgba(15, 23, 42, 0.86)",
          boxShadow: "0 26px 80px rgba(2, 6, 23, 0.45)",
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
          AutoFlow app
        </p>
        <h1 style={{ marginTop: "1rem", fontSize: "2.8rem", lineHeight: 1, letterSpacing: "-0.05em" }}>
          Operator workspace coming soon.
        </h1>
        <p style={{ marginTop: "1rem", color: "#94a3b8", lineHeight: 1.7 }}>
          The application shell is being rebuilt alongside the marketing launch. Use the landing page
          to request access and get notified when the operator workspace is ready.
        </p>
        <div
          style={{
            display: "flex",
            gap: "0.75rem",
            flexWrap: "wrap",
            marginTop: "1.5rem",
          }}
        >
          <Link
            href="/#waitlist"
            style={{
              padding: "0.9rem 1.2rem",
              borderRadius: "0.9rem",
              background: "#14b8a6",
              color: "#020617",
              fontWeight: 800,
            }}
          >
            Join waitlist
          </Link>
          <Link
            href="/"
            style={{
              padding: "0.9rem 1.2rem",
              borderRadius: "0.9rem",
              border: "1px solid rgba(148, 163, 184, 0.22)",
              color: "#f1f5f9",
              fontWeight: 700,
            }}
          >
            Back to landing page
          </Link>
        </div>
      </section>
    </main>
  );
}
