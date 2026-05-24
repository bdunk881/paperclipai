import type { ReactNode } from "react";

/**
 * Af2Tabs — generic tab strip primitive (HEL-203 / PR 1).
 *
 * Distilled from the inline tab strip used in Settings.tsx (lines 337–348)
 * and AgentDetail / WorkflowBuilder. Renders a horizontal row of buttons
 * styled with the `af2-tab` chrome (declared in dashboard/src/af2-components.css),
 * with the active tab underlined by the ::after pseudo-element.
 *
 * Generic over TKey so callers preserve narrow union types for activeTab /
 * onTabChange (e.g. "general" | "members" | "billing") instead of widening
 * to string. Each tab can optionally carry a count badge or a `proOnly`
 * flag — Pro-mode gating itself happens at the call site via
 * ExperienceModeContext; this component just renders the marker.
 *
 * ARIA: the outer container is `role=tablist`; each tab is `role=tab` with
 * `aria-selected` and `aria-controls` (pointing at `${idPrefix}-${key}` so
 * callers can pair tab buttons with their panels). Esc / arrow-key keyboard
 * traversal is intentionally NOT implemented in this PR — the tab strip is
 * a click target only; pressing Tab moves focus through tabs naturally and
 * Enter activates them. We'll layer roving-tabindex on in a follow-up when
 * a real screen-reader sweep needs it.
 */

export type Af2TabDescriptor<TKey extends string> = {
  key: TKey;
  label: string;
  count?: number;
  proOnly?: boolean;
};

export type Af2TabsProps<TKey extends string> = {
  tabs: Af2TabDescriptor<TKey>[];
  activeTab: TKey;
  onTabChange: (key: TKey) => void;
  /** Prefix used to build `aria-controls` ids (defaults to "af2-tab"). */
  idPrefix?: string;
  /** Optional extra class names appended to the .af2-tabs wrapper. */
  className?: string;
  /** Optional render slot for trailing content (e.g. a "Pro" badge). */
  trailing?: ReactNode;
};

export function Af2Tabs<TKey extends string>({
  tabs,
  activeTab,
  onTabChange,
  idPrefix = "af2-tab",
  className,
  trailing,
}: Af2TabsProps<TKey>) {
  const wrapperClass = ["af2-tabs", className].filter(Boolean).join(" ");

  return (
    <div role="tablist" className={wrapperClass}>
      {tabs.map((tab) => {
        const selected = tab.key === activeTab;
        const controlsId = `${idPrefix}-panel-${tab.key}`;
        const tabId = `${idPrefix}-tab-${tab.key}`;
        return (
          <button
            key={tab.key}
            id={tabId}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={controlsId}
            tabIndex={selected ? 0 : -1}
            className={`af2-tab${selected ? " active" : ""}`}
            onClick={() => onTabChange(tab.key)}
          >
            <span>{tab.label}</span>
            {typeof tab.count === "number" ? (
              <span className="af2-tab-count" aria-hidden="true">
                {" "}
                ({tab.count})
              </span>
            ) : null}
            {tab.proOnly ? (
              <span
                className="af2-tab-pro"
                aria-label="Pro mode only"
                title="Pro mode only"
                style={{
                  marginLeft: 6,
                  fontSize: 10,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: "var(--af2-clay)",
                }}
              >
                Pro
              </span>
            ) : null}
          </button>
        );
      })}
      {trailing ? (
        <div className="af2-tabs-trailing" style={{ marginLeft: "auto" }}>
          {trailing}
        </div>
      ) : null}
    </div>
  );
}
