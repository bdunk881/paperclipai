import { randomUUID } from "crypto";
import { parseJsonColumn, serializeJson } from "../db/json";
import { isPostgresConfigured, queryPostgres } from "../db/postgres";
import { GeneratedReport, ReportDelivery, ReportKind, ReportMetric, ReportSection, ReportTemplateConfig } from "./types";

interface ReportRow {
  id: string;
  user_id: string;
  team_id: string | null;
  kind: ReportKind;
  title: string;
  summary: string;
  period_start: string | null;
  period_end: string | null;
  template_json: unknown;
  sections_json: unknown;
  metrics_json: unknown;
  delivery_json: unknown;
  source_json: unknown;
  created_at: string;
  updated_at: string;
}

const memoryReports = new Map<string, GeneratedReport>();

function cloneReport(report: GeneratedReport): GeneratedReport {
  return {
    ...report,
    template: { ...report.template },
    sections: report.sections.map((section) => ({ ...section })),
    metrics: report.metrics.map((metric) => ({ ...metric })),
    delivery: report.delivery.map((entry) => ({ ...entry })),
    source: { ...report.source },
  };
}

function mapRow(row: ReportRow): GeneratedReport {
  return {
    id: row.id,
    userId: row.user_id,
    teamId: row.team_id ?? undefined,
    kind: row.kind,
    title: row.title,
    summary: row.summary,
    periodStart: row.period_start ? new Date(row.period_start).toISOString() : undefined,
    periodEnd: row.period_end ? new Date(row.period_end).toISOString() : undefined,
    template: parseJsonColumn<ReportTemplateConfig>(row.template_json, {}),
    sections: parseJsonColumn<ReportSection[]>(row.sections_json, []),
    metrics: parseJsonColumn<ReportMetric[]>(row.metrics_json, []),
    delivery: parseJsonColumn<ReportDelivery[]>(row.delivery_json, []),
    source: parseJsonColumn<Record<string, unknown>>(row.source_json, {}),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

async function persist(report: GeneratedReport): Promise<void> {
  if (!isPostgresConfigured()) {
    memoryReports.set(report.id, cloneReport(report));
    return;
  }

  await queryPostgres(
    `
      INSERT INTO generated_reports (
        id, user_id, team_id, kind, title, summary, period_start, period_end,
        template_json, sections_json, metrics_json, delivery_json, source_json,
        created_at, updated_at
      )
      VALUES (
        $1, $2, $3::uuid, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb, $12::jsonb, $13::jsonb, $14, $15
      )
      ON CONFLICT (id) DO UPDATE
      SET title = EXCLUDED.title,
          summary = EXCLUDED.summary,
          period_start = EXCLUDED.period_start,
          period_end = EXCLUDED.period_end,
          template_json = EXCLUDED.template_json,
          sections_json = EXCLUDED.sections_json,
          metrics_json = EXCLUDED.metrics_json,
          delivery_json = EXCLUDED.delivery_json,
          source_json = EXCLUDED.source_json,
          updated_at = EXCLUDED.updated_at
    `,
    [
      report.id,
      report.userId,
      report.teamId ?? null,
      report.kind,
      report.title,
      report.summary,
      report.periodStart ?? null,
      report.periodEnd ?? null,
      serializeJson(report.template),
      serializeJson(report.sections),
      serializeJson(report.metrics),
      serializeJson(report.delivery),
      serializeJson(report.source),
      report.createdAt,
      report.updatedAt,
    ]
  );
}

export const reportStore = {
  async save(input: Omit<GeneratedReport, "id" | "createdAt" | "updatedAt"> & { id?: string }): Promise<GeneratedReport> {
    const timestamp = new Date().toISOString();
    const report: GeneratedReport = {
      ...input,
      id: input.id ?? randomUUID(),
      createdAt: timestamp,
      updatedAt: timestamp,
      template: { ...(input.template ?? {}) },
      sections: input.sections.map((section) => ({ ...section })),
      metrics: input.metrics.map((metric) => ({ ...metric })),
      delivery: input.delivery.map((entry) => ({ ...entry })),
      source: { ...input.source },
    };

    await persist(report);
    return cloneReport(report);
  },

  async listByUser(userId: string, filters?: { teamId?: string; kind?: ReportKind }): Promise<GeneratedReport[]> {
    if (!isPostgresConfigured()) {
      return Array.from(memoryReports.values())
        .filter((report) => report.userId === userId)
        .filter((report) => (filters?.teamId ? report.teamId === filters.teamId : true))
        .filter((report) => (filters?.kind ? report.kind === filters.kind : true))
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .map(cloneReport);
    }

    const result = await queryPostgres<ReportRow>(
      `
        SELECT *
        FROM generated_reports
        WHERE user_id = $1
          AND ($2::uuid IS NULL OR team_id = $2::uuid)
          AND ($3::text IS NULL OR kind = $3)
        ORDER BY created_at DESC
      `,
      [userId, filters?.teamId ?? null, filters?.kind ?? null]
    );
    return result.rows.map(mapRow);
  },

  async getById(id: string, userId: string): Promise<GeneratedReport | undefined> {
    if (!isPostgresConfigured()) {
      const report = memoryReports.get(id);
      return report && report.userId === userId ? cloneReport(report) : undefined;
    }

    const result = await queryPostgres<ReportRow>(
      "SELECT * FROM generated_reports WHERE id = $1 AND user_id = $2",
      [id, userId]
    );
    return result.rows[0] ? mapRow(result.rows[0]) : undefined;
  },

  async clear(): Promise<void> {
    memoryReports.clear();
    if (!isPostgresConfigured()) {
      return;
    }
    await queryPostgres("DELETE FROM generated_reports");
  },
};
