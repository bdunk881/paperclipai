import { NavLink } from "react-router-dom";

const TABS = [
  { to: "/infra/overview", label: "Overview" },
  { to: "/infra/compute", label: "Compute" },
  { to: "/infra/edge", label: "Edge" },
  { to: "/infra/data", label: "Data" },
];

export function InfraTabs() {
  return (
    <div className="tabs" style={{ marginBottom: "1rem" }}>
      {TABS.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end
          style={({ isActive }) => ({
            padding: "0.5rem 1rem",
            color: isActive ? "#1c1c1e" : "#586271",
            borderBottom: isActive ? "2px solid #1f57d3" : "2px solid transparent",
            textDecoration: "none",
          })}
        >
          {t.label}
        </NavLink>
      ))}
    </div>
  );
}
