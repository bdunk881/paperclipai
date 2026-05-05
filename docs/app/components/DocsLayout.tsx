import { NavLink } from "react-router";

const NAV_SECTIONS = [
  {
    title: "Getting Started",
    items: [
      { label: "Introduction", href: "/" },
      { label: "Quick Start", href: "/getting-started" },
      { label: "Running via Docker", href: "/getting-started#docker" },
    ],
  },
  {
    title: "API Reference",
    items: [
      { label: "Overview", href: "/api-reference" },
      { label: "Templates", href: "/api-reference#templates" },
      { label: "Runs", href: "/api-reference#runs" },
      { label: "Webhooks", href: "/api-reference#webhooks" },
      { label: "Health", href: "/api-reference#health" },
    ],
  },
  {
    title: "Guides",
    items: [
      { label: "Workflow templates", href: "/getting-started#templates" },
      { label: "Self-hosting", href: "/getting-started#self-hosting" },
      { label: "Integration SDK v1", href: "/integrations-sdk-v1" },
    ],
  },
];

export function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#docs-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-indigo-600 focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-50 border-b border-slate-200 bg-slate-50/92 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-screen-xl items-center justify-between px-6">
          <div className="flex items-center gap-6">
            <a href="https://helloautoflow.com" className="text-lg font-bold text-indigo-600">
              AutoFlow
            </a>
            <span className="text-sm text-slate-300">|</span>
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                [
                  "text-sm transition-colors",
                  isActive ? "text-slate-950" : "text-slate-600 hover:text-slate-900",
                ].join(" ")
              }
            >
              Docs
            </NavLink>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <a
              href="https://helloautoflow.com/demo"
              className="text-slate-600 transition-colors hover:text-slate-900"
            >
              Demo
            </a>
            <a
              href="https://github.com/autoflow-hq/autoflow"
              className="text-slate-600 transition-colors hover:text-slate-900"
            >
              GitHub
            </a>
            <a
              href="https://helloautoflow.com/#pricing"
              className="rounded-lg bg-indigo-600 px-3 py-1.5 font-semibold text-white transition-colors hover:bg-indigo-700"
            >
              Start free
            </a>
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-screen-xl flex-1 px-6">
        <aside className="hidden w-64 shrink-0 py-8 pr-8 lg:block">
          <nav className="space-y-6">
            {NAV_SECTIONS.map((section) => (
              <div key={section.title}>
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                  {section.title}
                </p>
                <ul className="space-y-1">
                  {section.items.map((item) => (
                    <li key={item.href}>
                      <NavLink
                        to={item.href}
                        className={({ isActive }) =>
                          [
                            "block rounded-md px-3 py-1.5 text-sm transition-colors",
                            isActive
                              ? "bg-white text-slate-950 ring-1 ring-slate-200"
                              : "text-slate-600 hover:bg-white hover:text-slate-900",
                          ].join(" ")
                        }
                      >
                        {item.label}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </aside>

        <main
          id="docs-content"
          className="min-w-0 flex-1 py-8 lg:border-l lg:border-slate-200 lg:pl-8"
        >
          <div className="prose prose-gray max-w-none">
            {children}
          </div>
        </main>
      </div>

      <footer className="border-t border-slate-200 py-6">
        <div className="mx-auto max-w-screen-xl px-6 text-center text-sm text-slate-500">
          © {new Date().getFullYear()} AutoFlow.{" "}
          <a href="https://helloautoflow.com" className="hover:text-slate-900">
            helloautoflow.com
          </a>
        </div>
      </footer>
    </div>
  );
}
