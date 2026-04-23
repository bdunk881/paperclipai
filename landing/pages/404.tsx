import Link from "next/link";

export default function Custom404() {
  return (
    <main className="min-h-screen bg-[#020617] px-6 py-24 text-slate-100">
      <div className="mx-auto flex max-w-3xl flex-col gap-6 rounded-[28px] border border-slate-800 bg-slate-950/80 p-10 shadow-2xl shadow-slate-950/40">
        <p className="text-sm font-semibold uppercase tracking-[0.24em] text-teal-400">404</p>
        <h1 className="text-4xl font-semibold tracking-[-0.04em] text-white">
          This route is offline.
        </h1>
        <p className="max-w-2xl text-base leading-7 text-slate-400">
          The page you requested does not exist in the current AutoFlow surface.
        </p>
        <div>
          <Link
            href="/"
            className="inline-flex items-center rounded-2xl bg-teal-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:brightness-105"
          >
            Return home
          </Link>
        </div>
      </div>
    </main>
  );
}
