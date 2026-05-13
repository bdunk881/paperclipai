#!/usr/bin/env bash
# Pass 2: dark-mode variants + remaining standalone shades.
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

for f in "${FILES[@]}"; do
  [ -f "$f" ] || continue

  # Strip dark: variants of legacy colors (af2 tokens flip via CSS vars).
  # Match the whole `dark:CLASS` token and remove it (plus the preceding space).
  perl -i -pe 's/\s+dark:(?:bg|text|border|hover:bg|hover:text|hover:border|focus:bg|focus:text|focus:ring|focus-visible:bg|focus-visible:text)-(?:slate|gray|indigo|teal|orange|red|green|yellow|amber|emerald|violet|purple|rose|sky|blue|brand|accent[a-z-]*)-?[0-9a-z\/]*//g' "$f"

  # Pass-2 standalone shades that pass-1 missed
  perl -i -pe 's/\bbg-slate-700\b/bg-af2-ink-2/g' "$f"
  perl -i -pe 's/\bbg-slate-800\b/bg-af2-ink-2/g' "$f"
  perl -i -pe 's/\bbg-slate-900\b/bg-af2-ink/g' "$f"
  perl -i -pe 's/\bbg-slate-950\b/bg-af2-ink/g' "$f"
  perl -i -pe 's/\bbg-gray-700\b/bg-af2-ink-2/g' "$f"
  perl -i -pe 's/\bbg-gray-800\b/bg-af2-ink-2/g' "$f"
  perl -i -pe 's/\bbg-gray-900\b/bg-af2-ink/g' "$f"
  perl -i -pe 's/\bborder-slate-700\b/border-af2-line-2/g' "$f"
  perl -i -pe 's/\bborder-slate-800\b/border-af2-line/g' "$f"
  perl -i -pe 's/\bborder-gray-700\b/border-af2-line-2/g' "$f"
  perl -i -pe 's/\bborder-gray-800\b/border-af2-line/g' "$f"

  # Text-on-dark shades — flip to af2-paper since we're on cream now
  perl -i -pe 's/\btext-slate-100\b/text-af2-paper/g' "$f"
  perl -i -pe 's/\btext-slate-200\b/text-af2-paper-2/g' "$f"
  perl -i -pe 's/\btext-slate-300\b/text-af2-ink-3/g' "$f"
  perl -i -pe 's/\btext-gray-100\b/text-af2-paper/g' "$f"
  perl -i -pe 's/\btext-gray-200\b/text-af2-paper-2/g' "$f"
  perl -i -pe 's/\btext-gray-300\b/text-af2-ink-3/g' "$f"

  # Stray accent shades
  perl -i -pe 's|\bborder-orange-400\b|border-af2-clay/40|g' "$f"
  perl -i -pe 's|\bborder-orange-500\b|border-af2-clay/60|g' "$f"
  perl -i -pe 's|\bborder-indigo-400\b|border-af2-clay/40|g' "$f"
  perl -i -pe 's|\bborder-indigo-500\b|border-af2-clay/60|g' "$f"
  perl -i -pe 's|\bborder-teal-300\b|border-af2-sage/40|g' "$f"
  perl -i -pe 's|\bborder-teal-400\b|border-af2-sage/50|g' "$f"
  perl -i -pe 's|\btext-teal-100\b|text-af2-sage/80|g' "$f"
  perl -i -pe 's|\btext-teal-200\b|text-af2-sage/80|g' "$f"
  perl -i -pe 's|\btext-teal-300\b|text-af2-sage|g' "$f"
  perl -i -pe 's|\bbg-teal-600\b|bg-af2-sage|g' "$f"
  perl -i -pe 's|\bbg-blue-500\b|bg-af2-ink-blue|g' "$f"
  perl -i -pe 's|\bbg-blue-600\b|bg-af2-ink-blue|g' "$f"
  perl -i -pe 's|\bbg-blue-700\b|bg-af2-ink-blue|g' "$f"
  perl -i -pe 's|\btext-yellow-400\b|text-af2-mustard|g' "$f"
  perl -i -pe 's|\btext-yellow-500\b|text-af2-mustard|g' "$f"
  perl -i -pe 's|\btext-red-500\b|text-af2-clay|g' "$f"
done

echo "Pass 2 done."
