#!/usr/bin/env bash
set -e
FILES=(
  dashboard/src/pages/Approvals.tsx
  dashboard/src/pages/TicketSlaSettings.tsx
  dashboard/src/pages/LLMProviders.tsx
  dashboard/src/pages/IntegrationMarketplace.tsx
  dashboard/src/pages/ConnectorHealth.tsx
  dashboard/src/pages/MCPIntegrations.tsx
)
for f in "${FILES[@]}"; do
  [ -f "$f" ] || continue

  # Hover states the bare-class pass missed
  perl -i -pe 's/\bhover:bg-indigo-(400|500|600|700)\b/hover:bg-af2-clay-2/g' "$f"
  perl -i -pe 's/\bhover:bg-teal-(500|600|700)\b/hover:bg-af2-sage/g' "$f"
  perl -i -pe 's/\bhover:bg-red-(500|600|700)\b/hover:bg-af2-clay-2/g' "$f"
  perl -i -pe 's/\bhover:bg-orange-(500|600|700)\b/hover:bg-af2-clay-2/g' "$f"
  perl -i -pe 's|\bhover:border-teal-500/40\b|hover:border-af2-sage/40|g' "$f"

  # Object-literal strings (string-typed badges, accent maps)
  perl -i -pe 's|from-orange-50 to-white|from-af2-clay-soft/30 to-af2-card|g' "$f"
  perl -i -pe 's|from-indigo-50 to-white|from-af2-clay-soft/30 to-af2-card|g' "$f"
  perl -i -pe 's|from-teal-50 to-white|from-af2-sage/10 to-af2-card|g' "$f"
  perl -i -pe 's|border-orange-100|border-af2-clay/30|g' "$f"
  perl -i -pe 's|border-orange-300|border-af2-clay/40|g' "$f"
  perl -i -pe 's|border-indigo-100|border-af2-clay/30|g' "$f"
  perl -i -pe 's|border-indigo-300|border-af2-clay/40|g' "$f"
  perl -i -pe 's|border-teal-100|border-af2-sage/30|g' "$f"
  perl -i -pe 's|border-blue-100|border-af2-ink-blue/20|g' "$f"
  perl -i -pe 's|text-orange-100|text-af2-paper-2|g' "$f"
  perl -i -pe 's|text-orange-200|text-af2-paper-2|g' "$f"
  perl -i -pe 's|text-indigo-200|text-af2-paper-2|g' "$f"
  perl -i -pe 's|text-blue-900|text-af2-ink-blue|g' "$f"

  # Fix typo from earlier sweep: border-af2-clay/60/30 → border-af2-clay/30
  perl -i -pe 's|\bborder-af2-clay/60/30\b|border-af2-clay/30|g' "$f"
done
echo "Pass 3 done."
