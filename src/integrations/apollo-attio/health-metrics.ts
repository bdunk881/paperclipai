import { AttioClient } from "./attio-client";

export interface BetaRecord {
  record_id: string;
  name: string;
  first_workflow_date: string | null;
  activation_date: string | null;
  day7_nps: number | null;
  day30_nps: number | null;
  health_status: string | null;
  expansion_signals: string | null;
}

export interface HealthMetrics {
  generatedAt: string;
  totalRecords: number;
  activationPercent: number;
  healthDistribution: { green: number; amber: number; red: number; unknown: number };
  npsTrend: { day7Avg: number | null; day30Avg: number | null; day7Count: number; day30Count: number };
  expansionSignals: { count: number; percent: number };
  churnRisk: { count: number; percent: number };
}

function extractValue(values: any, slug: string): any {
  const entries = values?.[slug];
  if (!Array.isArray(entries) || entries.length === 0) return null;
  const entry = entries[0];
  // Handle different Attio attribute types
  if (entry.value !== undefined) return entry.value;
  if (entry.option !== undefined) return entry.option;
  if (entry.full_name !== undefined) return entry.full_name;
  return null;
}

function extractNumber(values: any, slug: string): number | null {
  const v = extractValue(values, slug);
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function parseRecords(rawRecords: any[]): BetaRecord[] {
  return rawRecords.map((r) => ({
    record_id: r.id?.record_id ?? "",
    name: extractValue(r.values, "name") ?? "(unnamed)",
    first_workflow_date: extractValue(r.values, "first_workflow_date"),
    activation_date: extractValue(r.values, "activation_date"),
    day7_nps: extractNumber(r.values, "day7_nps"),
    day30_nps: extractNumber(r.values, "day30_nps"),
    health_status: extractValue(r.values, "health_status"),
    expansion_signals: extractValue(r.values, "expansion_signals"),
  }));
}

export function calculateMetrics(records: BetaRecord[]): HealthMetrics {
  const total = records.length;

  // 1. Activation %
  const activated = records.filter((r) => r.first_workflow_date !== null).length;
  const activationPercent = total > 0 ? Math.round((activated / total) * 1000) / 10 : 0;

  // 2. Health Status Distribution
  const healthDistribution = { green: 0, amber: 0, red: 0, unknown: 0 };
  for (const r of records) {
    const status = (r.health_status ?? "").toLowerCase().trim();
    if (status === "green") healthDistribution.green++;
    else if (status === "amber") healthDistribution.amber++;
    else if (status === "red") healthDistribution.red++;
    else healthDistribution.unknown++;
  }

  // 3. NPS Trend
  const day7Scores = records.map((r) => r.day7_nps).filter((n): n is number => n !== null);
  const day30Scores = records.map((r) => r.day30_nps).filter((n): n is number => n !== null);
  const avg = (arr: number[]) => (arr.length > 0 ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10 : null);

  // 4. Expansion Signals
  const withExpansion = records.filter((r) => r.expansion_signals !== null && r.expansion_signals !== "").length;

  // 5. Churn Risk
  const churnRisk = healthDistribution.red;

  return {
    generatedAt: new Date().toISOString(),
    totalRecords: total,
    activationPercent,
    healthDistribution,
    npsTrend: {
      day7Avg: avg(day7Scores),
      day30Avg: avg(day30Scores),
      day7Count: day7Scores.length,
      day30Count: day30Scores.length,
    },
    expansionSignals: {
      count: withExpansion,
      percent: total > 0 ? Math.round((withExpansion / total) * 1000) / 10 : 0,
    },
    churnRisk: {
      count: churnRisk,
      percent: total > 0 ? Math.round((churnRisk / total) * 1000) / 10 : 0,
    },
  };
}

export function formatMarkdownReport(metrics: HealthMetrics): string {
  const { healthDistribution: hd, npsTrend: nps, expansionSignals: es, churnRisk: cr } = metrics;
  const healthTotal = hd.green + hd.amber + hd.red + hd.unknown;
  const pct = (n: number) => (healthTotal > 0 ? `${Math.round((n / healthTotal) * 1000) / 10}%` : "N/A");

  return `# Beta Cohort Health Report

**Generated:** ${metrics.generatedAt}
**Total Records:** ${metrics.totalRecords}

---

## 1. Activation Rate

| Metric | Value |
|--------|-------|
| Activated (first workflow completed) | ${metrics.activationPercent}% |

## 2. Health Status Distribution

| Status | Count | % |
|--------|-------|---|
| Green | ${hd.green} | ${pct(hd.green)} |
| Amber | ${hd.amber} | ${pct(hd.amber)} |
| Red | ${hd.red} | ${pct(hd.red)} |
| Unknown | ${hd.unknown} | ${pct(hd.unknown)} |

## 3. NPS Trend

| Metric | Average | Responses |
|--------|---------|-----------|
| Day 7 NPS | ${nps.day7Avg ?? "N/A"} | ${nps.day7Count} |
| Day 30 NPS | ${nps.day30Avg ?? "N/A"} | ${nps.day30Count} |

## 4. Expansion Signals

| Metric | Value |
|--------|-------|
| Customers with expansion signals | ${es.count} (${es.percent}%) |

## 5. Churn Risk

| Metric | Value |
|--------|-------|
| Customers at risk (Red status) | ${cr.count} (${cr.percent}%) |

---
*Report generated programmatically from Attio CRM data.*
`;
}

export async function fetchBetaCohortRecords(client: AttioClient): Promise<any[]> {
  const allRecords: any[] = [];
  let offset = 0;
  const limit = 500;

  // Fetch all beta_cohort records using tag filter
  while (true) {
    const batch = await client.listRecords(
      "companies",
      { tags: "beta_cohort" },
      limit
    );
    allRecords.push(...batch);
    if (batch.length < limit) break;
    offset += limit;
    // listRecords doesn't support offset yet, so break after first batch
    // For >500 records, pagination would need to be added to AttioClient
    break;
  }

  return allRecords;
}

export async function generateHealthReport(apiKey: string): Promise<{ metrics: HealthMetrics; markdown: string }> {
  const client = new AttioClient(apiKey);
  const rawRecords = await fetchBetaCohortRecords(client);
  const records = parseRecords(rawRecords);
  const metrics = calculateMetrics(records);
  const markdown = formatMarkdownReport(metrics);
  return { metrics, markdown };
}

// CLI entry point
if (require.main === module) {
  const apiKey = process.env.ATTIO_API_KEY;
  if (!apiKey) {
    console.error("Error: ATTIO_API_KEY environment variable is required");
    process.exit(1);
  }

  const outputFormat = process.argv.includes("--json") ? "json" : "markdown";

  generateHealthReport(apiKey)
    .then(({ metrics, markdown }) => {
      if (outputFormat === "json") {
        console.log(JSON.stringify(metrics, null, 2));
      } else {
        console.log(markdown);
      }
    })
    .catch((err) => {
      console.error("Failed to generate health report:", err.message);
      process.exit(1);
    });
}
