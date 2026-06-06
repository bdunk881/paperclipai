/**
 * Embedded Sanity Studio at /studio (HEL-732).
 *
 * The Studio is a heavy, browser-only SPA, so every `sanity` import is dynamic
 * and runs only after hydration — the Cloudflare Worker SSR bundle never pulls
 * it in, and the chunk loads only on /studio (route-level code split).
 *
 * Auth is Sanity's own login (no public write access). projectId/dataset are
 * the public blog Sanity (`koldjrka`/`production`) — safe to ship client-side.
 */
import { useEffect, useState, type ComponentType } from "react";

export function meta() {
  return [
    { title: "AutoFlow Studio" },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export default function StudioRoute() {
  const [StudioApp, setStudioApp] = useState<ComponentType | null>(null);

  useEffect(() => {
    // import.meta.env.SSR is statically `true` in the Worker build, so Rollup
    // dead-code-eliminates the Sanity dynamic import below out of the server
    // bundle entirely (keeping the heavy Studio client-only).
    if (import.meta.env.SSR) return;
    let active = true;
    void Promise.all([
      import("sanity"),
      import("sanity/structure"),
      import("../../sanity/schema"),
    ]).then(([{ Studio, defineConfig }, { structureTool }, { schemaTypes }]) => {
      const config = defineConfig({
        name: "autoflow-landing",
        title: "AutoFlow",
        projectId: "koldjrka",
        dataset: "production",
        basePath: "/studio",
        plugins: [structureTool()],
        schema: { types: schemaTypes },
      });
      if (active) {
        const App: ComponentType = () => <Studio config={config} />;
        setStudioApp(() => App);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  if (!StudioApp) {
    return (
      <div
        style={{
          display: "grid",
          placeItems: "center",
          minHeight: "100vh",
          fontFamily: "system-ui, sans-serif",
          color: "#6b5a48",
        }}
      >
        Loading Studio…
      </div>
    );
  }

  return <StudioApp />;
}
