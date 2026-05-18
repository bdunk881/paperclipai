import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import clsx from "clsx";
import {
  AlertCircle,
  BarChart2,
  CheckCircle2,
  Clock,
  Database,
  FileText,
  Layers,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import pdfWorkerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import {
  deleteMemoryEntry,
  getMemoryStats,
  listMemoryEntries,
  searchMemory,
  writeMemoryEntry,
  type MemoryEntry,
  type MemoryStats,
} from "../api/client";

GlobalWorkerOptions.workerSrc = pdfWorkerSrc;

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const DEFAULT_STATS: MemoryStats = { totalEntries: 0, totalBytes: 0, workflowCount: 0 };
const EMPTY_ROW_ID = 1;

type UploadState = "idle" | "uploading" | "success" | "error";

type QaRow = {
  id: number;
  question: string;
  answer: string;
};

function ttlLabel(seconds?: number): string {
  if (!seconds) return "No expiry";
  if (seconds < 3600) return `${seconds / 60}min TTL`;
  if (seconds < 86400) return `${seconds / 3600}h TTL`;
  return `${seconds / 86400}d TTL`;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function sanitizeKeySegment(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "entry";
}

function validateFiles(candidates: File[]): string | null {
  if (candidates.length === 0) return null;
  for (const file of candidates) {
    const lowerName = file.name.toLowerCase();
    const supported =
      file.type === "application/pdf" ||
      lowerName.endsWith(".pdf") ||
      lowerName.endsWith(".txt") ||
      lowerName.endsWith(".md") ||
      lowerName.endsWith(".markdown") ||
      file.type.startsWith("text/");
    if (!supported) {
      return "File too large or invalid format";
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      return "File too large or invalid format";
    }
  }
  return null;
}

async function extractPdfText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const pdf = await getDocument({ data: buffer }).promise;
  const pageTexts = await Promise.all(
    Array.from({ length: pdf.numPages }, async (_, index) => {
      const page = await pdf.getPage(index + 1);
      const content = await page.getTextContent();
      return content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
    })
  );
  const text = pageTexts.filter(Boolean).join("\n\n");
  if (!text.trim()) {
    throw new Error("Unable to extract readable text from PDF");
  }
  return text;
}

async function parseKnowledgeFile(file: File): Promise<string> {
  const lowerName = file.name.toLowerCase();
  if (file.type === "application/pdf" || lowerName.endsWith(".pdf")) {
    return extractPdfText(file);
  }
  return file.text();
}

function buildQaText(question: string, answer: string): string {
  return `Question: ${question.trim()}\nAnswer: ${answer.trim()}`;
}

export default function Memory() {
  const { user, requireAccessToken } = useAuth();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [stats, setStats] = useState<MemoryStats>(DEFAULT_STATS);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<MemoryEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [files, setFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [rows, setRows] = useState<QaRow[]>([{ id: EMPTY_ROW_ID, question: "", answer: "" }]);
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [progress, setProgress] = useState({ current: 0, total: 0 });

  const loadEntries = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const accessToken = await requireAccessToken();
      const [fetched, fetchedStats] = await Promise.all([
        search.trim()
          ? searchMemory(search, accessToken, user?.id).then((results) => results.map((result) => result.entry))
          : listMemoryEntries(accessToken, user?.id),
        getMemoryStats(accessToken, user?.id),
      ]);
      setEntries(fetched);
      setStats(fetchedStats);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load memory entries");
    } finally {
      setLoading(false);
    }
  }, [requireAccessToken, search, user?.id]);

  useEffect(() => {
    const debounce = setTimeout(() => void loadEntries(), search.trim() ? 300 : 0);
    return () => clearTimeout(debounce);
  }, [loadEntries, search]);

  async function handleDelete(id: string) {
    try {
      const accessToken = await requireAccessToken();
      await deleteMemoryEntry(id, accessToken, user?.id);
      setEntries((prev) => prev.filter((entry) => entry.id !== id));
      if (selected?.id === id) setSelected(null);
      void getMemoryStats(accessToken, user?.id).then(setStats);
    } catch {
      // Keep entry visible when deletion fails.
    }
  }

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  function applySelectedFiles(nextFiles: File[]) {
    const validation = validateFiles(nextFiles);
    if (validation) {
      setUploadState("error");
      setUploadMessage(validation);
      return;
    }
    setFiles(nextFiles);
    setUploadState("idle");
    setUploadMessage(null);
  }

  function handleDrop(event: React.DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    setDragOver(false);
    applySelectedFiles(Array.from(event.dataTransfer.files));
  }

  function addRow() {
    setRows((prev) => [...prev, { id: Date.now(), question: "", answer: "" }]);
  }

  function updateRow(id: number, field: "question" | "answer", value: string) {
    setRows((prev) =>
      prev.map((row) => (row.id === id ? { ...row, [field]: value } : row))
    );
  }

  function removeRow(id: number) {
    setRows((prev) => (prev.length === 1 ? prev.map((row) => ({ ...row, question: "", answer: "" })) : prev.filter((row) => row.id !== id)));
  }

  async function handleIngest() {
    const qaRows = rows.filter((row) => row.question.trim() && row.answer.trim());
    if (files.length === 0 && qaRows.length === 0) {
      setUploadState("error");
      setUploadMessage("Add at least one file or one complete Q&A row");
      return;
    }

    setUploadState("uploading");
    setUploadMessage(null);
    const totalOperations = files.length + qaRows.length;
    setProgress({ current: 0, total: totalOperations });
    const accessToken = await requireAccessToken();

    const createdEntries: MemoryEntry[] = [];
    try {
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        const text = await parseKnowledgeFile(file);
        const entry = await writeMemoryEntry(
          {
            key: `knowledge.file.${sanitizeKeySegment(file.name)}.${Date.now()}-${index + 1}`,
            text,
            workflowName: "Knowledge Ingest",
          },
          accessToken,
          user?.id
        );
        createdEntries.push(entry);
        setProgress({ current: index + 1, total: totalOperations });
      }

      for (let index = 0; index < qaRows.length; index += 1) {
        const row = qaRows[index];
        const entry = await writeMemoryEntry(
          {
            key: `knowledge.qa.${Date.now()}-${row.id}-${index + 1}`,
            text: buildQaText(row.question, row.answer),
            workflowName: "Knowledge Ingest",
          },
          accessToken,
          user?.id
        );
        createdEntries.push(entry);
        setProgress({ current: files.length + index + 1, total: totalOperations });
      }

      setUploadState("success");
      setUploadMessage(
        `${createdEntries.length} knowledge ${createdEntries.length === 1 ? "entry" : "entries"} ingested successfully`
      );
      setFiles([]);
      setRows([{ id: EMPTY_ROW_ID, question: "", answer: "" }]);
      setSelected(createdEntries[0] ?? null);
      await loadEntries();
    } catch (err) {
      setUploadState("error");
      setUploadMessage(err instanceof Error ? err.message : "Failed to ingest knowledge");
    }
  }

  const progressPercent =
    progress.total > 0 ? Math.max(8, Math.round((progress.current / progress.total) * 100)) : 0;

  return (
    <div className="min-h-full bg-af2-paper text-af2-ink">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-6 md:px-8 md:py-8">
        {/* DASH-35: stripped V1 glass-card + noise-overlay classes and
            the V1 indigo/teal radial gradient. Kept the af2-card border
            + radius so the page-head visual rhythm survives. */}
        <section className="af2-card overflow-hidden">
          <div className="relative border-b border-af2-line px-8 py-7">
            <div className="relative flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-2xl">
                <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-af2-clay/40 bg-af2-clay-soft px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-af2-clay">
                  <Sparkles size={12} />
                  Data / Knowledge
                </div>
                <h1 className="text-2xl font-semibold text-af2-ink md:text-[24px]">
                  Knowledge Ingest
                </h1>
                <p className="mt-2 max-w-xl text-sm text-af2-ink-4">
                  Ingest source files and structured Q&A pairs into the shared memory layer for
                  workflows and agents.
                </p>
              </div>
              <button
                onClick={() => void loadEntries()}
                className="inline-flex items-center gap-2 self-start rounded-xl border border-af2-line bg-af2-card px-4 py-2 text-sm font-medium text-af2-ink-4 transition hover:border-af2-line hover:bg-af2-paper-2 hover:text-af2-ink"
                title="Refresh memory data"
              >
                <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
                Refresh store
              </button>
            </div>
          </div>

          <div className="grid gap-4 border-b border-af2-line px-8 py-6 md:grid-cols-3">
            <MetricCard icon={<Database size={14} />} label="Total Entries" value={stats.totalEntries} />
            <MetricCard
              icon={<BarChart2 size={14} />}
              label="Storage Used"
              value={`${(stats.totalBytes / 1024).toFixed(1)} KB`}
              helper="Current workspace memory footprint"
            />
            <MetricCard
              icon={<Layers size={14} />}
              label="Active Workflows"
              value={stats.workflowCount}
              helper="Writing into shared agent/workflow context"
            />
          </div>

          <div className="grid gap-6 px-8 py-8 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
            <section className="space-y-4">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-af2-ink-3">
                  File Dropzone
                </h2>
                <p className="mt-2 text-sm text-af2-ink-4">
                  Supports PDF, TXT, and MD up to 10 MB per file.
                </p>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.txt,.md,.markdown,text/plain,application/pdf,text/markdown"
                multiple
                className="hidden"
                onChange={(event) => applySelectedFiles(Array.from(event.target.files ?? []))}
              />

              <button
                type="button"
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={openFilePicker}
                className={clsx(
                  // DASH-35: removed V1 glass-card + indigo glow shadow
                  // on drag-over. Pure af2 paper-style now.
                  "w-full rounded-md border-2 border-dashed px-6 py-10 text-left transition-all duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-af2-clay focus-visible:ring-offset-2 focus-visible:ring-offset-af2-paper",
                  dragOver
                    ? "border-af2-clay bg-af2-clay/5"
                    : "border-af2-line bg-af2-card hover:border-af2-clay hover:bg-af2-paper",
                  uploadState === "success" && "border-af2-sage/80",
                  uploadState === "error" && "border-af2-clay/80"
                )}
                aria-label="Knowledge ingest file dropzone"
              >
                <div className="flex flex-col items-center gap-4 text-center">
                  {uploadState === "uploading" ? (
                    <Loader2 size={32} className="animate-spin text-af2-clay" />
                  ) : uploadState === "success" ? (
                    <CheckCircle2 size={32} className="text-af2-sage" />
                  ) : uploadState === "error" ? (
                    <AlertCircle size={32} className="text-af2-clay" />
                  ) : (
                    <UploadCloud size={32} className="text-af2-clay" />
                  )}

                  <div>
                    <p className="text-sm font-medium text-af2-ink">
                      Drag &amp; drop files here or click to browse
                    </p>
                    <p className="mt-1 text-xs text-af2-ink-4">
                      Supports PDF, TXT, MD (Max 10MB)
                    </p>
                  </div>

                  {files.length > 0 && (
                    <div className="flex flex-wrap justify-center gap-2">
                      {files.map((file) => (
                        <span
                          key={`${file.name}-${file.size}`}
                          className="inline-flex items-center gap-2 rounded-full border border-af2-line bg-af2-paper-2 px-3 py-1 text-xs text-af2-ink-4"
                        >
                          <FileText size={12} />
                          {file.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </button>
            </section>

            <section className="space-y-4">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-af2-ink-3">
                    Manual Q&amp;A Table
                  </h2>
                  <p className="mt-2 text-sm text-af2-ink-4">
                    Capture exact questions and answers as searchable memory entries.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={addRow}
                  className="glow-border inline-flex items-center gap-2 rounded-xl border border-af2-clay/40 bg-transparent px-3 py-2 text-sm font-medium text-af2-clay transition hover:bg-af2-clay-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-af2-clay focus-visible:ring-offset-2 focus-visible:ring-offset-af2-paper"
                >
                  <Plus size={14} />
                  Add row
                </button>
              </div>

              <div className="af2-card overflow-hidden">
                <div className="hidden grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)_88px] gap-4 bg-af2-paper-2 px-4 py-3 md:grid">
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-af2-ink-4">
                    Question
                  </span>
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-af2-ink-4">
                    Answer
                  </span>
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-af2-ink-4">
                    Actions
                  </span>
                </div>

                <div className="divide-y divide-af2-line">
                  {rows.map((row, index) => (
                    <div
                      key={row.id}
                      className="grid gap-3 px-4 py-4 transition-colors duration-200 ease-in-out hover:bg-af2-paper md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)_88px] md:items-start"
                    >
                      <div className="space-y-2">
                        <label className="text-[11px] font-semibold uppercase tracking-[0.18em] text-af2-ink-4 md:hidden">
                          Question
                        </label>
                        <textarea
                          rows={3}
                          value={row.question}
                          onChange={(event) => updateRow(row.id, "question", event.target.value)}
                          placeholder="What should the agent know?"
                          className="min-h-[92px] w-full resize-y rounded-xl border border-af2-line bg-af2-card px-3 py-2 text-sm text-af2-ink placeholder:text-af2-ink-3 transition focus:bg-af2-card focus:outline-none focus:ring-2 focus:ring-af2-clay"
                        />
                      </div>

                      <div className="space-y-2">
                        <label className="text-[11px] font-semibold uppercase tracking-[0.18em] text-af2-ink-4 md:hidden">
                          Answer
                        </label>
                        <textarea
                          rows={3}
                          value={row.answer}
                          onChange={(event) => updateRow(row.id, "answer", event.target.value)}
                          placeholder="Provide the canonical answer or context."
                          className="min-h-[92px] w-full resize-y rounded-xl border border-af2-line bg-af2-card px-3 py-2 text-sm text-af2-ink placeholder:text-af2-ink-3 transition focus:bg-af2-card focus:outline-none focus:ring-2 focus:ring-af2-clay"
                        />
                      </div>

                      <div className="flex items-center justify-between gap-3 md:justify-end">
                        <span className="text-xs text-af2-ink-4 md:hidden">Row {index + 1}</span>
                        <button
                          type="button"
                          onClick={() => removeRow(row.id)}
                          className="inline-flex items-center gap-2 rounded-xl border border-af2-line px-3 py-2 text-sm text-af2-ink-4 transition hover:border-af2-clay/40 hover:text-af2-clay focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-af2-clay"
                          aria-label={`Remove Q&A row ${index + 1}`}
                        >
                          <Trash2 size={14} />
                          <span className="md:hidden">Remove</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </div>

          <div className="space-y-4 border-t border-af2-line px-8 py-6">
            {uploadState === "uploading" && (
              <div className="space-y-2">
                <div className="h-1 overflow-hidden rounded-full bg-af2-paper-3">
                  <div
                    className="h-full rounded-full bg-af2-clay transition-all duration-200 ease-in-out"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                <p className="text-xs text-af2-ink-3">
                  Ingesting {progress.current} of {progress.total} entries
                </p>
              </div>
            )}

            {uploadMessage && (
              <div
                className={clsx(
                  "rounded-xl border px-4 py-3 text-sm",
                  uploadState === "success" &&
                    "border-af2-sage/40 bg-af2-sage/10 text-af2-sage-2",
                  uploadState === "error" && "border-af2-clay/40 bg-af2-clay/10 text-af2-clay-2"
                )}
              >
                {uploadMessage}
              </div>
            )}

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-af2-ink-4">
                Focus states remain keyboard-visible, and manual rows collapse into stacked cards
                on smaller screens.
              </p>
              <button
                type="button"
                onClick={() => void handleIngest()}
                disabled={uploadState === "uploading"}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-af2-clay px-6 py-3 text-sm font-bold text-white transition hover:bg-af2-clay-2 disabled:cursor-not-allowed disabled:bg-af2-paper-3 disabled:text-af2-ink-3"
              >
                {uploadState === "uploading" ? (
                  <>
                    <Loader2 size={15} className="animate-spin" />
                    Ingesting…
                  </>
                ) : (
                  <>
                    <UploadCloud size={15} />
                    Ingest Knowledge
                  </>
                )}
              </button>
            </div>
          </div>
        </section>

        {error && (
          <div className="rounded-xl border border-af2-clay/40 bg-af2-clay/10 px-4 py-3 text-sm text-af2-clay-2">
            {error}
          </div>
        )}

        <section className="af2-card grid gap-0 overflow-hidden xl:grid-cols-[380px_minmax(0,1fr)]">
          <div className="border-b border-af2-line bg-af2-paper/90 xl:border-b-0 xl:border-r">
            <div className="border-b border-af2-line p-4">
              <div className="relative">
                <Search
                  size={14}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-af2-ink-3"
                />
                <input
                  className="w-full rounded-xl border border-af2-line bg-af2-card py-2 pl-9 pr-3 text-sm text-af2-ink placeholder:text-af2-ink-3 focus:outline-none focus:ring-2 focus:ring-af2-clay"
                  placeholder="Search keys or content..."
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>
            </div>

            <div className="max-h-[640px] overflow-y-auto">
              {loading && entries.length === 0 ? (
                <div className="flex h-36 flex-col items-center justify-center text-sm text-af2-ink-4">
                  <RefreshCw size={20} className="mb-2 animate-spin opacity-50" />
                  Loading memory store…
                </div>
              ) : entries.length === 0 ? (
                <div className="flex h-36 flex-col items-center justify-center text-sm text-af2-ink-4">
                  <Database size={24} className="mb-2 opacity-30" />
                  {search ? "No results" : "No memory entries yet"}
                </div>
              ) : (
                entries.map((entry) => (
                  <div
                    key={entry.id}
                    className={clsx(
                      "border-b border-af2-line transition hover:bg-af2-paper",
                      selected?.id === entry.id && "bg-af2-clay-soft"
                    )}
                  >
                    <div className="flex items-start gap-3 px-4 py-4">
                      <button
                        type="button"
                        onClick={() => setSelected(entry)}
                        className="min-w-0 flex-1 text-left"
                        aria-label={`Select memory entry ${entry.key}`}
                        aria-pressed={selected?.id === entry.id}
                      >
                        <div className="flex flex-col gap-2">
                          <div className="flex items-start justify-between gap-3">
                            <span className="truncate font-mono text-xs text-af2-ink-4">{entry.key}</span>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 text-[11px] text-af2-ink-4">
                            <span>{entry.workflowName ?? entry.workflowId ?? "Knowledge Ingest"}</span>
                            <span>·</span>
                            <Clock size={10} />
                            <span>{timeAgo(entry.updatedAt)}</span>
                            {entry.ttlSeconds && (
                              <>
                                <span>·</span>
                                <span className="text-af2-mustard">{ttlLabel(entry.ttlSeconds)}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDelete(entry.id)}
                        className="shrink-0 rounded-lg p-1 text-af2-ink-4 transition hover:bg-af2-clay/10 hover:text-af2-clay"
                        aria-label={`Delete memory entry ${entry.key}`}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="min-h-[420px] p-6 md:p-8">
            {selected ? (
              <div>
                <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-af2-ink-4">
                      Selected Entry
                    </p>
                    <h2 className="break-all font-mono text-lg font-semibold text-af2-ink">
                      {selected.key}
                    </h2>
                  </div>
                  <button
                    onClick={() => void handleDelete(selected.id)}
                    className="inline-flex items-center gap-2 rounded-xl border border-af2-clay/30 px-3 py-2 text-sm text-af2-clay-2 transition hover:bg-af2-clay/10"
                  >
                    <Trash2 size={14} />
                    Delete
                  </button>
                </div>

                <div className="mb-6 grid gap-4 md:grid-cols-2">
                  <DetailCard label="Workflow" value={selected.workflowName ?? selected.workflowId ?? "—"} />
                  {selected.agentId ? <DetailCard label="Agent" value={selected.agentId} mono /> : null}
                  <DetailCard label="TTL" value={ttlLabel(selected.ttlSeconds)} />
                  <DetailCard label="Last Updated" value={timeAgo(selected.updatedAt)} />
                  {selected.expiresAt ? (
                    <div className="rounded-2xl border border-af2-mustard/40 bg-af2-mustard/10 p-4 md:col-span-2">
                      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-af2-mustard-2">
                        Expires At
                      </div>
                      <div className="mt-2 text-sm text-af2-mustard-2">
                        {new Date(selected.expiresAt).toLocaleString()}
                      </div>
                    </div>
                  ) : null}
                </div>

                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-af2-ink-4">
                    Value
                  </label>
                  <pre className="overflow-x-auto rounded-2xl border border-af2-line bg-af2-paper px-4 py-4 text-xs leading-relaxed text-af2-sage-2">
                    {(() => {
                      try {
                        return JSON.stringify(JSON.parse(selected.text), null, 2);
                      } catch {
                        return selected.text;
                      }
                    })()}
                  </pre>
                </div>
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center text-center text-af2-ink-4">
                <Database size={40} className="mb-4 opacity-30" />
                <p className="text-sm text-af2-ink-4">Select a memory entry to inspect the ingested payload.</p>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  helper,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  helper?: string;
}) {
  return (
    <div className="rounded-2xl border border-af2-line bg-af2-card/95 p-4">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-af2-ink-4">
        {icon}
        {label}
      </div>
      <div className="text-2xl font-semibold text-af2-ink">{value}</div>
      {helper ? <div className="mt-1 text-xs text-af2-ink-4">{helper}</div> : null}
    </div>
  );
}

function DetailCard({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-af2-line bg-af2-paper p-4">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-af2-ink-4">{label}</div>
      <div className={clsx("mt-2 text-sm text-af2-ink", mono && "font-mono")}>{value}</div>
    </div>
  );
}
