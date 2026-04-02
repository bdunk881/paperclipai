import Link from "next/link";
import PipMascot from "@/components/PipMascot";

export default function NotFound() {
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-6 text-center"
      style={{ background: "linear-gradient(135deg, #4A3AFF 0%, #00D4B8 100%)" }}
    >
      {/* Background grid */}
      <div
        className="fixed inset-0 opacity-10 pointer-events-none"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.2) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.2) 1px, transparent 1px)",
          backgroundSize: "50px 50px",
        }}
      />

      <div className="relative z-10 flex flex-col items-center gap-6 max-w-lg">
        {/* Pip with a map/confused expression */}
        <div className="relative">
          <div className="animate-float">
            <PipMascot size={160} />
          </div>
          {/* Map emoji floating above */}
          <div
            className="absolute -top-4 -right-4 w-12 h-12 rounded-full flex items-center justify-center text-2xl"
            style={{ background: "rgba(255,255,255,0.9)", boxShadow: "0 4px 12px rgba(0,0,0,0.15)" }}
          >
            🗺️
          </div>
          {/* Question mark bubble */}
          <div
            className="absolute -top-2 left-1/2 -translate-x-1/2 -translate-y-full px-3 py-1 rounded-2xl text-sm font-bold"
            style={{ background: "#FFD93D", color: "#0F1333" }}
          >
            ???
          </div>
        </div>

        <div>
          <h1
            className="text-8xl font-extrabold text-white mb-2"
            style={{ fontFamily: "var(--font-poppins, Poppins, sans-serif)" }}
          >
            404
          </h1>
          <h2
            className="text-2xl font-bold text-white/90 mb-3"
            style={{ fontFamily: "var(--font-poppins, Poppins, sans-serif)" }}
          >
            Pip is lost!
          </h2>
          <p className="text-white/70 text-lg leading-relaxed">
            This page doesn&apos;t seem to exist. Even with a map, Pip can&apos;t find it.
            Let&apos;s get you back on track!
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-4">
          <Link
            href="/"
            className="px-8 py-3 rounded-full font-bold text-indigo-700 bg-white transition-all hover:scale-105"
          >
            ← Back to Home
          </Link>
          <Link
            href="/app"
            className="px-8 py-3 rounded-full font-bold text-white border-2 border-white/40 hover:border-white hover:bg-white/10 transition-all"
          >
            Open App →
          </Link>
        </div>

        <p className="text-white/40 text-sm">
          Lost in automation? Pip will help you find the right flow.
        </p>
      </div>
    </div>
  );
}
