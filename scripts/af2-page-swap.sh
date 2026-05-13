#!/usr/bin/env bash
# Bulk af2 token swap across HEL-59 → HEL-65 dashboard pages.
# Run from repo root. Throwaway script — safe to delete after sweep lands.
set -e

FILES=(
  dashboard/src/pages/Approvals.tsx
  dashboard/src/pages/AgentActivity.tsx
  dashboard/src/pages/BudgetDashboard.tsx
  dashboard/src/pages/MCPIntegrations.tsx
  dashboard/src/pages/ConnectorHealth.tsx
  dashboard/src/pages/IntegrationMarketplace.tsx
  dashboard/src/pages/Integrations.tsx
  dashboard/src/pages/LLMProviders.tsx
  dashboard/src/pages/ApiKeys.tsx
  dashboard/src/pages/Settings.tsx
  dashboard/src/pages/ProfileSettings.tsx
  dashboard/src/pages/SecuritySettings.tsx
  dashboard/src/pages/NotificationsSettings.tsx
  dashboard/src/pages/TicketSlaSettings.tsx
  dashboard/src/pages/Templates.tsx
  dashboard/src/pages/AgentCatalog.tsx
)

# Substitutions as (legacy, replacement) pairs.
SUBS=(
  # Ink (text) ladder
  's/\btext-slate-400\b/text-af2-ink-3/g'
  's/\btext-slate-500\b/text-af2-ink-3/g'
  's/\btext-slate-600\b/text-af2-ink-2/g'
  's/\btext-slate-700\b/text-af2-ink-2/g'
  's/\btext-slate-800\b/text-af2-ink/g'
  's/\btext-slate-900\b/text-af2-ink/g'
  's/\btext-slate-950\b/text-af2-ink/g'
  's/\btext-gray-400\b/text-af2-ink-4/g'
  's/\btext-gray-500\b/text-af2-ink-3/g'
  's/\btext-gray-600\b/text-af2-ink-2/g'
  's/\btext-gray-700\b/text-af2-ink-2/g'
  's/\btext-gray-800\b/text-af2-ink/g'
  's/\btext-gray-900\b/text-af2-ink/g'

  # Paper / card backgrounds
  's/\bbg-white\b/bg-af2-card/g'
  's|\bbg-slate-50\b|bg-af2-paper-2/40|g'
  's/\bbg-slate-100\b/bg-af2-paper-2/g'
  's/\bbg-slate-200\b/bg-af2-paper-2/g'
  's|\bbg-gray-50\b|bg-af2-paper-2/40|g'
  's/\bbg-gray-100\b/bg-af2-paper-2/g'
  's/\bbg-gray-200\b/bg-af2-paper-2/g'

  # Borders
  's/\bborder-slate-100\b/border-af2-line/g'
  's/\bborder-slate-200\b/border-af2-line/g'
  's/\bborder-slate-300\b/border-af2-line-2/g'
  's/\bborder-gray-100\b/border-af2-line/g'
  's/\bborder-gray-200\b/border-af2-line/g'
  's/\bborder-gray-300\b/border-af2-line-2/g'

  # Brand / accent (clay)
  's/\bbg-brand-500\b/bg-af2-clay/g'
  's/\bbg-brand-600\b/bg-af2-clay/g'
  's/\bbg-brand-700\b/bg-af2-clay-2/g'
  's/\bhover:bg-brand-500\b/hover:bg-af2-clay-2/g'
  's/\bhover:bg-brand-600\b/hover:bg-af2-clay-2/g'
  's/\bhover:bg-brand-700\b/hover:bg-af2-clay-2/g'
  's|\bbg-brand-50\b|bg-af2-clay-soft/40|g'
  's/\bbg-brand-100\b/bg-af2-clay-soft/g'
  's/\btext-brand-500\b/text-af2-clay/g'
  's/\btext-brand-600\b/text-af2-clay/g'
  's/\btext-brand-700\b/text-af2-clay/g'
  's/\btext-brand-800\b/text-af2-clay/g'
  's/\btext-brand-900\b/text-af2-ink/g'
  's|\bborder-brand-200\b|border-af2-clay/30|g'
  's|\bborder-brand-300\b|border-af2-clay/40|g'
  's/\bborder-brand-500\b/border-af2-clay/g'

  # Status colors → af2 palette
  # green/teal/emerald → sage (success/live)
  's|\bbg-green-50\b|bg-af2-sage/10|g'
  's|\bbg-green-100\b|bg-af2-sage/15|g'
  's/\bbg-green-500\b/bg-af2-sage/g'
  's/\bbg-green-600\b/bg-af2-sage/g'
  's/\btext-green-600\b/text-af2-sage/g'
  's/\btext-green-700\b/text-af2-sage/g'
  's/\btext-green-800\b/text-af2-sage/g'
  's|\bborder-green-200\b|border-af2-sage/30|g'
  's|\bborder-green-300\b|border-af2-sage/50|g'

  's|\bbg-teal-50\b|bg-af2-sage/10|g'
  's|\bbg-teal-100\b|bg-af2-sage/15|g'
  's/\bbg-teal-500\b/bg-af2-sage/g'
  's/\btext-teal-600\b/text-af2-sage/g'
  's/\btext-teal-700\b/text-af2-sage/g'
  's|\bborder-teal-200\b|border-af2-sage/30|g'

  's|\bbg-emerald-50\b|bg-af2-sage/10|g'
  's|\bbg-emerald-100\b|bg-af2-sage/15|g'
  's/\btext-emerald-600\b/text-af2-sage/g'
  's/\btext-emerald-700\b/text-af2-sage/g'

  # orange/red/rose → clay (alert/error)
  's|\bbg-orange-50\b|bg-af2-clay-soft/40|g'
  's/\bbg-orange-100\b/bg-af2-clay-soft/g'
  's/\bbg-orange-500\b/bg-af2-clay/g'
  's/\bbg-orange-600\b/bg-af2-clay-2/g'
  's/\btext-orange-600\b/text-af2-clay/g'
  's/\btext-orange-700\b/text-af2-clay/g'
  's/\btext-orange-800\b/text-af2-clay/g'
  's|\bborder-orange-200\b|border-af2-clay/30|g'

  's|\bbg-red-50\b|bg-af2-clay-soft/30|g'
  's|\bbg-red-100\b|bg-af2-clay-soft/60|g'
  's/\bbg-red-500\b/bg-af2-clay/g'
  's/\bbg-red-600\b/bg-af2-clay-2/g'
  's/\btext-red-600\b/text-af2-clay/g'
  's/\btext-red-700\b/text-af2-clay/g'
  's/\btext-red-800\b/text-af2-clay/g'
  's|\bborder-red-200\b|border-af2-clay/30|g'
  's|\bborder-red-300\b|border-af2-clay/40|g'

  's|\bbg-rose-50\b|bg-af2-clay-soft/30|g'
  's|\bbg-rose-100\b|bg-af2-clay-soft/60|g'
  's/\btext-rose-600\b/text-af2-clay/g'
  's/\btext-rose-700\b/text-af2-clay/g'

  # yellow/amber → mustard (pending/awaiting)
  's|\bbg-yellow-50\b|bg-af2-mustard/10|g'
  's|\bbg-yellow-100\b|bg-af2-mustard/15|g'
  's/\bbg-yellow-500\b/bg-af2-mustard/g'
  's/\btext-yellow-600\b/text-af2-mustard/g'
  's/\btext-yellow-700\b/text-af2-mustard/g'
  's/\btext-yellow-800\b/text-af2-mustard/g'
  's|\bborder-yellow-200\b|border-af2-mustard/30|g'

  's|\bbg-amber-50\b|bg-af2-mustard/10|g'
  's|\bbg-amber-100\b|bg-af2-mustard/15|g'
  's/\btext-amber-600\b/text-af2-mustard/g'
  's/\btext-amber-700\b/text-af2-mustard/g'
  's|\bborder-amber-200\b|border-af2-mustard/30|g'

  # purple/violet → plum (governance/escalated)
  's|\bbg-purple-50\b|bg-af2-plum/10|g'
  's|\bbg-purple-100\b|bg-af2-plum/15|g'
  's/\btext-purple-600\b/text-af2-plum/g'
  's/\btext-purple-700\b/text-af2-plum/g'
  's|\bborder-purple-200\b|border-af2-plum/30|g'

  's|\bbg-violet-50\b|bg-af2-plum/10|g'
  's|\bbg-violet-100\b|bg-af2-plum/15|g'
  's/\btext-violet-600\b/text-af2-plum/g'
  's/\btext-violet-700\b/text-af2-plum/g'

  # indigo (was accent in v1) → clay
  's|\bbg-indigo-50\b|bg-af2-clay-soft/40|g'
  's/\bbg-indigo-100\b/bg-af2-clay-soft/g'
  's/\bbg-indigo-500\b/bg-af2-clay/g'
  's/\bbg-indigo-600\b/bg-af2-clay/g'
  's/\btext-indigo-500\b/text-af2-clay/g'
  's/\btext-indigo-600\b/text-af2-clay/g'
  's/\btext-indigo-700\b/text-af2-clay/g'
  's|\bborder-indigo-200\b|border-af2-clay/30|g'

  # blue → ink-blue (developer surfaces)
  's|\bbg-blue-50\b|bg-af2-ink-blue/10|g'
  's|\bbg-blue-100\b|bg-af2-ink-blue/15|g'
  's/\btext-blue-500\b/text-af2-ink-blue/g'
  's/\btext-blue-600\b/text-af2-ink-blue/g'
  's/\btext-blue-700\b/text-af2-ink-blue/g'
  's|\bborder-blue-200\b|border-af2-ink-blue/30|g'

  # Accent shorthand (legacy v1)
  's/\btext-accent-orange\b/text-af2-clay/g'
  's/\bborder-accent-orange\b/border-af2-clay/g'
  's/\bbg-accent-orange\b/bg-af2-clay/g'
  's/\btext-accent-teal\b/text-af2-sage/g'
  's/\bbg-accent-teal\b/bg-af2-sage/g'
)

for f in "${FILES[@]}"; do
  if [ ! -f "$f" ]; then
    echo "SKIP missing: $f"
    continue
  fi
  for sub in "${SUBS[@]}"; do
    sed -i "$sub" "$f"
  done
done

echo "Swap done across ${#FILES[@]} files."
