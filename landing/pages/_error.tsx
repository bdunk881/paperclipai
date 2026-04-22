import Link from "next/link";
import type { NextPageContext } from "next";

interface ErrorPageProps {
  statusCode: number;
}

export default function ErrorPage({ statusCode }: ErrorPageProps) {
  return (
    <main className="min-h-screen bg-[#020617] px-6 py-24 text-slate-100">
      <div className="mx-auto flex max-w-3xl flex-col gap-6 rounded-[28px] border border-slate-800 bg-slate-950/80 p-10 shadow-2xl shadow-slate-950/40">
        <p className="text-sm font-semibold uppercase tracking-[0.24em] text-orange-400">
          Error {statusCode}
        </p>
        <h1 className="text-4xl font-semibold tracking-[-0.04em] text-white">
          Something interrupted the request.
        </h1>
        <p className="max-w-2xl text-base leading-7 text-slate-400">
          The AutoFlow landing surface hit an unexpected error while rendering this route.
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

ErrorPage.getInitialProps = ({ res, err }: NextPageContext): ErrorPageProps => ({
  statusCode: res?.statusCode ?? err?.statusCode ?? 500,
});
