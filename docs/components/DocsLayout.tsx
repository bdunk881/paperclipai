import Link from "next/link";

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
    ],
  },
];

export function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      {/* Top nav */}
      <header className="sticky top-0 z-50 border-b border-gray-200 bg-white/90 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-screen-xl items-center justify-between px-6">
          <div className="flex items-center gap-6">
            <Link href="https://helloautoflow.com" className="font-bold text-indigo-600 text-lg">
              AutoFlow
            </Link>
            <span className="text-gray-300 text-sm">|</span>
            <Link href="/" className="text-sm text-gray-600 hover:text-gray-900">
              Docs
            </Link>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <Link
              href="https://helloautoflow.com/demo"
              className="text-gray-600 hover:text-gray-900 transition-colors"
            >
              Demo
            </Link>
            <Link
              href="https://github.com/autoflow-hq/autoflow"
              className="text-gray-600 hover:text-gray-900 transition-colors"
            >
              GitHub
            </Link>
            <Link
              href="https://helloautoflow.com/#pricing"
              className="rounded-lg bg-indigo-600 px-3 py-1.5 font-semibold text-white hover:bg-indigo-700 transition-colors"
            >
              Start free
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-screen-xl flex-1 px-6">
        {/* Sidebar */}
        <aside className="hidden w-64 shrink-0 py-8 pr-8 lg:block">
          <nav className="space-y-6">
            {NAV_SECTIONS.map((section) => (
              <div key={section.title}>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
                  {section.title}
                </p>
                <ul className="space-y-1">
                  {section.items.map((item) => (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className="block rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors"
                      >
                        {item.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </aside>

        {/* Main content */}
        <main className="min-w-0 flex-1 py-8 lg:pl-8 lg:border-l lg:border-gray-100">
          <div className="prose prose-gray max-w-none">
            {children}
          </div>
        </main>
      </div>

      <footer className="border-t border-gray-100 py-6">
        <div className="mx-auto max-w-screen-xl px-6 text-center text-sm text-gray-500">
          © {new Date().getFullYear()} AutoFlow.{" "}
          <Link href="https://helloautoflow.com" className="hover:text-gray-900">
            helloautoflow.com
          </Link>
        </div>
      </footer>
    </div>
  );
}
