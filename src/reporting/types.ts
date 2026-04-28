export type ReportKind = "board_memo" | "financial_statement" | "postmortem";
export type ReportDeliveryChannel = "inbox" | "email";
export type ReportDeliveryStatus = "pending" | "sent" | "failed";

export interface ReportMetric {
  key: string;
  label: string;
  value: number | string;
  unit?: "count" | "currency_minor" | "percent" | "text";
}

export interface ReportSection {
  title: string;
  body: string;
}

export interface ReportDelivery {
  channel: ReportDeliveryChannel;
  status: ReportDeliveryStatus;
  recipient?: string;
  sentAt?: string;
  error?: string;
}

export interface ReportTemplateConfig {
  headline?: string;
  footerNote?: string;
  sectionTitles?: string[];
}

export interface GeneratedReport {
  id: string;
  userId: string;
  teamId?: string;
  kind: ReportKind;
  title: string;
  summary: string;
  periodStart?: string;
  periodEnd?: string;
  template: ReportTemplateConfig;
  sections: ReportSection[];
  metrics: ReportMetric[];
  delivery: ReportDelivery[];
  source: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}
