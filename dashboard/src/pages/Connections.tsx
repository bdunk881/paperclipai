/**
 * Connections — Run pillar hub for everything an operator plugs into AutoFlow.
 *
 * Ports the v2 "Consolidation Preview" prototype
 * (`docs/design/v2/preview/consolidation.html` lines 1030–1232) into React.
 * Visuals are driven entirely by the `.af2-v2` scoped stylesheet
 * (`src/styles/af2-v2-shell.css`) — the Pro-only tabs/panels/blocks are
 * shown via `[data-pro="on"]` on the outer wrapper, so SMB and Pro
 * presentations live in the same component.
 *
 * The page is intentionally self-contained: tab state, row-drawer state,
 * and per-scope permission state are all `useState` locally. Real wiring
 * to `/api/connector-grants` lands in a follow-up; until then the rows
 * mutate in-place so QA can exercise the slider UI.
 */
import { useState, type ReactNode } from "react";
import { useExperienceMode } from "../context/ExperienceModeContext";

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

type TabId = "integrations" | "models" | "mcp" | "health" | "env-vars";

interface TabDef {
  id: TabId;
  label: string;
  pro?: boolean;
}

const TABS: readonly TabDef[] = [
  { id: "integrations", label: "Integrations" },
  { id: "models", label: "Models" },
  { id: "mcp", label: "MCP Servers", pro: true },
  { id: "health", label: "Health", pro: true },
  { id: "env-vars", label: "Environment Variables", pro: true },
];

// ---------------------------------------------------------------------------
// Tri-state permission slider — matches the prototype's button group.
// ---------------------------------------------------------------------------

type Perm = "allow" | "ask" | "deny";

interface PermSliderProps {
  value: Perm;
  onChange: (next: Perm) => void;
}

function PermSlider({ value, onChange }: PermSliderProps) {
  return (
    <div className="perm-slider" role="group" aria-label="Permission">
      <button
        type="button"
        className="allow"
        aria-selected={value === "allow"}
        onClick={(event) => {
          event.stopPropagation();
          onChange("allow");
        }}
      >
        Allow
      </button>
      <button
        type="button"
        className="ask"
        aria-selected={value === "ask"}
        onClick={(event) => {
          event.stopPropagation();
          onChange("ask");
        }}
      >
        Ask
      </button>
      <button
        type="button"
        className="deny"
        aria-selected={value === "deny"}
        onClick={(event) => {
          event.stopPropagation();
          onChange("deny");
        }}
      >
        Don&apos;t allow
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scope-tree with per-row tri-state perm sliders. Keys are stable strings
// so the local map can survive re-renders without reseeding.
// ---------------------------------------------------------------------------

interface ScopeRow {
  key: string;
  label: ReactNode;
  initial: Perm;
}

interface ScopeGroup {
  label: string;
  rows: ScopeRow[];
}

function ScopeTree({ groups }: { groups: ScopeGroup[] }) {
  const [values, setValues] = useState<Record<string, Perm>>(() => {
    const seed: Record<string, Perm> = {};
    for (const g of groups) for (const r of g.rows) seed[r.key] = r.initial;
    return seed;
  });
  return (
    <div className="scope-tree">
      {groups.map((group) => (
        <div key={group.label}>
          <div className="scope-tree-group-label">{group.label}</div>
          {group.rows.map((row) => (
            <div key={row.key} className="scope-tree-row">
              <div className="scope-tree-label">{row.label}</div>
              <PermSlider
                value={values[row.key] ?? row.initial}
                onChange={(next) =>
                  setValues((prev) => ({ ...prev, [row.key]: next }))
                }
              />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Integration row + collapsible drawer.
// ---------------------------------------------------------------------------

interface IntegrationRowProps {
  id: string;
  logo: string;
  name: string;
  desc: string;
  pill: ReactNode;
  action: ReactNode;
  expanded: boolean;
  onToggle: (id: string) => void;
  children?: ReactNode;
}

function IntegrationRow({
  id,
  logo,
  name,
  desc,
  pill,
  action,
  expanded,
  onToggle,
  children,
}: IntegrationRowProps) {
  return (
    <>
      <div
        className="int-row"
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={() => onToggle(id)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onToggle(id);
          }
        }}
      >
        <div className="int-logo">{logo}</div>
        <div>
          <div className="int-name">{name}</div>
          <div className="int-desc">{desc}</div>
        </div>
        {pill}
        {action}
      </div>
      <div className={`row-drawer${expanded ? " open" : ""}`}>{children}</div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------

const HUBSPOT_SCOPES: ScopeGroup[] = [
  {
    label: "Per mission",
    rows: [
      {
        key: "hs:m04",
        label: (
          <>
            <span className="ico">M-04</span> Book 5 demos this week
          </>
        ),
        initial: "allow",
      },
      {
        key: "hs:m05",
        label: (
          <>
            <span className="ico">M-05</span> Launch v2 features
          </>
        ),
        initial: "ask",
      },
      {
        key: "hs:m06",
        label: (
          <>
            <span className="ico">M-06</span> Audit Q2 churn
          </>
        ),
        initial: "deny",
      },
    ],
  },
  {
    label: "Per team",
    rows: [
      { key: "hs:t:sales", label: "Sales", initial: "allow" },
      { key: "hs:t:marketing", label: "Marketing", initial: "ask" },
    ],
  },
  {
    label: "Per agent",
    rows: [
      { key: "hs:a:aaron", label: "Aaron · Sales SDR", initial: "allow" },
      { key: "hs:a:mira", label: "Mira · Marketing Manager", initial: "ask" },
    ],
  },
];

const ENV_ACME_SCOPES: ScopeGroup[] = [
  {
    label: "Per mission",
    rows: [
      { key: "env:m04", label: "M-04 · Book 5 demos", initial: "allow" },
      { key: "env:m05", label: "M-05 · Launch v2", initial: "ask" },
    ],
  },
  {
    label: "Per agent",
    rows: [{ key: "env:aaron", label: "Aaron", initial: "allow" }],
  },
];

function IntegrationsPanel() {
  const [openId, setOpenId] = useState<string | null>("hubspot");
  const toggle = (id: string) => setOpenId((cur) => (cur === id ? null : id));
  const collapse = () => setOpenId(null);

  return (
    <div className="panel" role="tabpanel" id="con-int">
      <div className="int-cat">CRM &amp; sales</div>
      <IntegrationRow
        id="hubspot"
        logo="H"
        name="HubSpot"
        desc="Contacts · Companies · Deals"
        pill={<span className="pill dot sage">connected</span>}
        action={
          <button type="button" className="btn sm" onClick={(e) => e.stopPropagation()}>
            Manage
          </button>
        }
        expanded={openId === "hubspot"}
        onToggle={toggle}
      >
        <div className="row-drawer-head">
          <div>
            <div className="eyebrow" style={{ marginBottom: 4 }}>
              Connection · CRM
            </div>
            <h3>HubSpot · permissions</h3>
          </div>
          <button
            type="button"
            className="btn ghost sm"
            onClick={(event) => {
              event.stopPropagation();
              collapse();
            }}
          >
            Collapse ↑
          </button>
        </div>
        <p style={{ fontSize: 13, color: "var(--af2-ink-2)" }}>
          Set per-scope access. <b>Allow</b> = unrestricted · <b>Ask</b> = approval
          required before each call · <b>Don&apos;t allow</b> = blocked.
        </p>
        <ScopeTree groups={HUBSPOT_SCOPES} />
        <div className="pro-only pro-block">
          <div className="label">Pro · Raw HubSpot config</div>
          <pre>{`client_id:     hs_pub_8f3a…
client_secret: ********  (set 2026-04-12)
scopes:        contacts.read,deals.write,owners.read
webhook_url:   https://api.helloautoflow.com/webhooks/hubspot`}</pre>
        </div>
      </IntegrationRow>

      <IntegrationRow
        id="salesforce"
        logo="S"
        name="Salesforce"
        desc="Lead routing · Opportunity sync"
        pill={<span className="pill">not connected</span>}
        action={
          <button
            type="button"
            className="btn primary sm"
            onClick={(e) => e.stopPropagation()}
          >
            Connect
          </button>
        }
        expanded={openId === "salesforce"}
        onToggle={toggle}
      >
        <div className="row-drawer-head">
          <h3>Salesforce</h3>
        </div>
      </IntegrationRow>

      <div className="int-cat">Messaging</div>
      <IntegrationRow
        id="slack"
        logo="#"
        name="Slack"
        desc="Channels · DMs · approvals"
        pill={<span className="pill dot sage">connected</span>}
        action={
          <button type="button" className="btn sm" onClick={(e) => e.stopPropagation()}>
            Manage
          </button>
        }
        expanded={openId === "slack"}
        onToggle={toggle}
      >
        <div className="row-drawer-head">
          <h3>Slack</h3>
        </div>
      </IntegrationRow>

      <IntegrationRow
        id="gmail"
        logo="@"
        name="Gmail"
        desc="Send · draft · labels"
        pill={<span className="pill dot clay">auth failed</span>}
        action={
          <button
            type="button"
            className="btn primary sm"
            onClick={(e) => e.stopPropagation()}
          >
            Reconnect
          </button>
        }
        expanded={openId === "gmail"}
        onToggle={toggle}
      >
        <div className="row-drawer-head">
          <h3>Gmail</h3>
        </div>
      </IntegrationRow>
    </div>
  );
}

function ModelsPanel() {
  return (
    <div className="panel" role="tabpanel" id="con-models">
      <div className="grid-2">
        <div className="card">
          <h3>Anthropic</h3>
          <div className="desc">
            Powers <b>large</b> tier · sk-ant-…RyZ4 · last used 2 min ago
          </div>
          <div style={{ marginTop: 10 }}>
            <span className="pill dot sage">healthy</span>
          </div>
          <div className="pro-only pro-block">
            <div className="label">Pro · Tier routing</div>
            <pre>{`small:      openai/gpt-4o-mini
medium:     anthropic/claude-haiku-4-5
large:      anthropic/claude-opus-4-7
embeddings: openai/text-embedding-3-small`}</pre>
          </div>
        </div>
        <div className="card">
          <h3>OpenAI</h3>
          <div className="desc">
            Powers <b>small</b> tier · sk-…aB12 · last used 14s ago
          </div>
          <div style={{ marginTop: 10 }}>
            <span className="pill dot sage">healthy</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function McpPanel() {
  return (
    <div className="panel" role="tabpanel" id="con-mcp">
      <div className="card">
        <h3>Custom MCP servers</h3>
        <p className="desc">
          Bring your own MCP server (stdio or HTTP). Each server&apos;s tools get a
          scope-permission slider just like integrations.
        </p>
        <div className="int-row" style={{ marginTop: 10 }}>
          <div className="int-logo">N</div>
          <div>
            <div className="int-name">Notion MCP</div>
            <div className="int-desc">https://mcp.notion.example · 14 tools</div>
          </div>
          <span className="pill dot sage">healthy</span>
          <button type="button" className="btn sm">
            Manage
          </button>
        </div>
      </div>
    </div>
  );
}

function HealthPanel() {
  return (
    <div className="panel" role="tabpanel" id="con-health">
      <div className="card card-list" style={{ padding: 0 }}>
        <div
          className="row"
          style={{
            gridTemplateColumns: "1fr 130px 110px 110px 110px",
            background: "var(--af2-paper-2)",
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
          }}
        >
          <div>Connector</div>
          <div>Status</div>
          <div>Last poll</div>
          <div>Errors 24h</div>
          <div></div>
        </div>
        <div
          className="row"
          style={{ gridTemplateColumns: "1fr 130px 110px 110px 110px" }}
        >
          <div>
            <b>HubSpot</b>
            <br />
            <span className="id">conn_01H7Z…</span>
          </div>
          <div>
            <span className="pill dot sage">healthy</span>
          </div>
          <div className="id">12s ago</div>
          <div>0</div>
          <div className="actions">
            <button type="button" className="btn sm">
              Logs
            </button>
          </div>
        </div>
        <div
          className="row"
          style={{ gridTemplateColumns: "1fr 130px 110px 110px 110px" }}
        >
          <div>
            <b>Gmail</b>
            <br />
            <span className="id">conn_01H7K…</span>
          </div>
          <div>
            <span className="pill dot clay">auth_failed</span>
          </div>
          <div className="id">3h ago</div>
          <div>47</div>
          <div className="actions">
            <button type="button" className="btn primary sm">
              Reconnect
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function EnvVarsPanel() {
  const [openId, setOpenId] = useState<string | null>("acme");
  const toggle = (id: string) => setOpenId((cur) => (cur === id ? null : id));
  const collapse = () => setOpenId(null);

  return (
    <div className="panel" role="tabpanel" id="con-env">
      <div className="info-strip">
        Encrypted at rest (pgcrypto, mirrors <code>provisioned_company_secrets</code>) ·
        values are <b>write-only</b> · agents get short-lived signed deref tokens at
        execution time · audit row on every grant change · <b>cannot drift</b>.
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
        <button type="button" className="btn primary">
          + Add env var
        </button>
      </div>
      <div className="card card-list" style={{ padding: 0 }}>
        <div
          className="row"
          style={{
            gridTemplateColumns: "1fr 1fr 110px 110px 200px",
            background: "var(--af2-paper-2)",
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
          }}
        >
          <div>Name</div>
          <div>Scopes</div>
          <div>Last used</div>
          <div></div>
          <div></div>
        </div>

        <div
          className="row"
          role="button"
          tabIndex={0}
          aria-expanded={openId === "acme"}
          style={{
            gridTemplateColumns: "1fr 1fr 110px 110px 200px",
            cursor: "pointer",
          }}
          onClick={() => toggle("acme")}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              toggle("acme");
            }
          }}
        >
          <div>
            <code style={{ fontSize: 12 }}>ACME_API_KEY</code>
          </div>
          <div>
            <span className="pill">2 missions</span>{" "}
            <span className="pill">1 agent</span>
          </div>
          <div className="id">2m ago</div>
          <div>—</div>
          <div className="actions">
            <button type="button" className="btn sm" onClick={(e) => e.stopPropagation()}>
              Manage scopes
            </button>
            <button
              type="button"
              className="btn danger sm"
              onClick={(e) => e.stopPropagation()}
            >
              Rotate
            </button>
          </div>
        </div>
        <div className={`row-drawer${openId === "acme" ? " open" : ""}`}>
          <div className="row-drawer-head">
            <div>
              <div className="eyebrow" style={{ marginBottom: 4 }}>
                Env var · encrypted
              </div>
              <h3>
                <code>ACME_API_KEY</code>
              </h3>
            </div>
            <button
              type="button"
              className="btn ghost sm"
              onClick={(event) => {
                event.stopPropagation();
                collapse();
              }}
            >
              Collapse ↑
            </button>
          </div>
          <p style={{ fontSize: 13 }}>
            Created 2026-04-12 · key_version 2 · never returned in API responses
          </p>
          <ScopeTree groups={ENV_ACME_SCOPES} />
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button type="button" className="btn">
              Rotate value
            </button>
            <button type="button" className="btn danger">
              Delete
            </button>
          </div>
          <div className="pro-only pro-block">
            <div className="label">Pro · Audit log (last 5)</div>
            <pre>{`2026-05-24 15:14 · grant.update · M-05 → ask (by Brad)
2026-05-23 09:02 · access     · agt_aaron at M-04 (deref token)
2026-05-22 18:40 · create     · ACME_API_KEY (by Brad)
2026-05-22 18:40 · grant      · M-04 → allow (by Brad)
2026-04-12 11:01 · key.rotate · key_version 1 → 2`}</pre>
          </div>
        </div>

        <div
          className="row"
          role="button"
          tabIndex={0}
          aria-expanded={openId === "stripe"}
          style={{
            gridTemplateColumns: "1fr 1fr 110px 110px 200px",
            cursor: "pointer",
          }}
          onClick={() => toggle("stripe")}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              toggle("stripe");
            }
          }}
        >
          <div>
            <code style={{ fontSize: 12 }}>STRIPE_SECRET_KEY</code>
          </div>
          <div>
            <span className="pill">1 team</span>
          </div>
          <div className="id">5h ago</div>
          <div>—</div>
          <div className="actions">
            <button type="button" className="btn sm" onClick={(e) => e.stopPropagation()}>
              Manage scopes
            </button>
            <button
              type="button"
              className="btn danger sm"
              onClick={(e) => e.stopPropagation()}
            >
              Rotate
            </button>
          </div>
        </div>
        <div className={`row-drawer${openId === "stripe" ? " open" : ""}`}>
          <div className="row-drawer-head">
            <h3>STRIPE_SECRET_KEY</h3>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function Connections() {
  const { mode } = useExperienceMode();
  const isPro = mode === "pro";
  const [active, setActive] = useState<TabId>("integrations");

  return (
    <div className="af2-v2" data-pro={isPro ? "on" : "off"}>
      <section className="hub" data-hub="connections">
        <div className="page-head">
          <div className="page-head-left">
            <div className="eyebrow">Run · Connections</div>
            <h1 className="h1">Connections</h1>
            <div className="meta">
              14 connected · per-mission / per-team / per-agent permission scoping ·
              moved to Run pillar
            </div>
          </div>
        </div>

        <div className="pro-banner">
          Pro mode reveals <b>MCP Servers</b>, <b>Health</b>, and{" "}
          <b>Environment Variables</b> tabs · plus raw client/secret fields per
          connector.
        </div>

        <div className="tabs" role="tablist" aria-label="Connections sections">
          {TABS.map((tab) => {
            const selected = active === tab.id;
            const cls = tab.pro ? "tab pro-tab" : "tab";
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={selected}
                className={cls}
                onClick={() => setActive(tab.id)}
              >
                {tab.label}
                {tab.pro && <span className="pro-chip">PRO</span>}
              </button>
            );
          })}
        </div>

        <div hidden={active !== "integrations"}>
          <IntegrationsPanel />
        </div>
        <div hidden={active !== "models"}>
          <ModelsPanel />
        </div>
        <div hidden={active !== "mcp"}>
          <McpPanel />
        </div>
        <div hidden={active !== "health"}>
          <HealthPanel />
        </div>
        <div hidden={active !== "env-vars"}>
          <EnvVarsPanel />
        </div>
      </section>
    </div>
  );
}
