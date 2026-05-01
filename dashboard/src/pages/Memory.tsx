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
    <div className="min-h-full bg-slate-50 text-slate-900 dark:bg-surface-base dark:text-slate-100">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-6 md:px-8 md:py-8">
        <section className="glass-card noise-overlay overflow-hidden rounded-[28px] border border-slate-200 bg-white/90 dark:border-slate-800/80">
          <div className="relative border-b border-slate-200 px-8 py-7 dark:border-slate-800/80">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(99,102,241,0.16),transparent_40%),radial-gradient(circle_at_bottom_left,rgba(20,184,166,0.12),transparent_35%)]" />
            <div className="relative flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-2xl">
                <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-indigo-200">
                  <Sparkles size={12} />
                  Data / Knowledge
                </div>
                <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100 md:text-[24px]">
                  Knowledge Ingest
                </h1>
                <p className="mt-2 max-w-xl text-sm text-slate-600 dark:text-slate-400">
                  Ingest source files and structured Q&A pairs into the shared memory layer for
                  workflows and agents.
                </p>
              </div>
              <button
                onClick={() => void loadEntries()}
                className="inline-flex items-center gap-2 self-start rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:bg-slate-800/80 dark:hover:text-slate-100"
                title="Refresh memory data"
              >
                <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
                Refresh store
              </button>
            </div>
          </div>

          <div className="grid gap-4 border-b border-slate-200 px-8 py-6 dark:border-slate-800/70 md:grid-cols-3">
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
                <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">
                  File Dropzone
                </h2>
                <p className="mt-2 text-sm text-slate-500">
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
                  "glass-card w-full rounded-2xl border-2 border-dashed px-6 py-10 text-left transition-all duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-50 dark:focus-visible:ring-offset-surface-base",
                  dragOver
                    ? "border-indigo-500 bg-indigo-500/5 shadow-[0_0_15px_rgba(99,102,241,0.2)]"
                    : "border-slate-300 bg-white hover:border-indigo-500 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/70",
                  uploadState === "success" && "border-emerald-500/80",
                  uploadState === "error" && "border-red-500/80"
                )}
                aria-label="Knowledge ingest file dropzone"
              >
                <div className="flex flex-col items-center gap-4 text-center">
                  {uploadState === "uploading" ? (
                    <Loader2 size={32} className="animate-spin text-indigo-400" />
                  ) : uploadState === "success" ? (
                    <CheckCircle2 size={32} className="text-emerald-400" />
                  ) : uploadState === "error" ? (
                    <AlertCircle size={32} className="text-red-400" />
                  ) : (
                    <UploadCloud size={32} className="text-indigo-400" />
                  )}

                  <div>
                    <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                      Drag &amp; drop files here or click to browse
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Supports PDF, TXT, MD (Max 10MB)
                    </p>
                  </div>

                  {files.length > 0 && (
                    <div className="flex flex-wrap justify-center gap-2">
                      {files.map((file) => (
                        <span
                          key={`${file.name}-${file.size}`}
                          className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-300"
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
                  <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">
                    Manual Q&amp;A Table
                  </h2>
                  <p className="mt-2 text-sm text-slate-500">
                    Capture exact questions and answers as searchable memory entries.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={addRow}
                  className="glow-border inline-flex items-center gap-2 rounded-xl border border-indigo-500/40 bg-transparent px-3 py-2 text-sm font-medium text-indigo-300 transition hover:bg-indigo-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-50 dark:focus-visible:ring-offset-surface-base"
                >
                  <Plus size={14} />
                  Add row
                </button>
              </div>

              <div className="glass-card overflow-hidden rounded-2xl border border-slate-200 bg-white/90 dark:border-slate-700/80">
                <div className="hidden grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)_88px] gap-4 bg-slate-100 px-4 py-3 dark:bg-[rgba(30,41,59,0.8)] md:grid">
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                    Question
                  </span>
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                    Answer
                  </span>
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                    Actions
                  </span>
                </div>

                <div className="divide-y divide-slate-200 dark:divide-slate-800/90">
                  {rows.map((row, index) => (
                    <div
                      key={row.id}
                      className="grid gap-3 px-4 py-4 transition-colors duration-200 ease-in-out hover:bg-slate-50 dark:hover:bg-slate-800/50 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)_88px] md:items-start"
                    >
                      <div className="space-y-2">
                        <label className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 md:hidden">
                          Question
                        </label>
                        <textarea
                          rows={3}
                          value={row.question}
                          onChange={(event) => updateRow(row.id, "question", event.target.value)}
                          placeholder="What should the agent know?"
                          className="min-h-[92px] w-full resize-y rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 transition focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400 dark:border-slate-700/70 dark:bg-transparent dark:text-slate-100 dark:placeholder:text-slate-600 dark:focus:bg-surface-base"
                        />
                      </div>

                      <div className="space-y-2">
                        <label className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 md:hidden">
                          Answer
                        </label>
                        <textarea
                          rows={3}
                          value={row.answer}
                          onChange={(event) => updateRow(row.id, "answer", event.target.value)}
                          placeholder="Provide the canonical answer or context."
                          className="min-h-[92px] w-full resize-y rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 transition focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400 dark:border-slate-700/70 dark:bg-transparent dark:text-slate-100 dark:placeholder:text-slate-600 dark:focus:bg-surface-base"
                        />
                      </div>

                      <div className="flex items-center justify-between gap-3 md:justify-end">
                        <span className="text-xs text-slate-500 md:hidden">Row {index + 1}</span>
                        <button
                          type="button"
                          onClick={() => removeRow(row.id)}
                          className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-500 transition hover:border-red-500/40 hover:text-red-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 dark:border-slate-700 dark:text-slate-400 dark:hover:text-red-400"
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

          <div className="space-y-4 border-t border-slate-200 px-8 py-6 dark:border-slate-800/70">
            {uploadState === "uploading" && (
              <div className="space-y-2">
                <div className="h-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                  <div
                    className="h-full rounded-full bg-indigo-500 transition-all duration-200 ease-in-out"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                <p className="text-xs text-slate-400">
                  Ingesting {progress.current} of {progress.total} entries
                </p>
              </div>
            )}

            {uploadMessage && (
              <div
                className={clsx(
                  "rounded-xl border px-4 py-3 text-sm",
                  uploadState === "success" &&
                    "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
                  uploadState === "error" && "border-red-500/40 bg-red-500/10 text-red-300"
                )}
              >
                {uploadMessage}
              </div>
            )}

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-slate-500">
                Focus states remain keyboard-visible, and manual rows collapse into stacked cards
                on smaller screens.
              </p>
              <button
                type="button"
                onClick={() => void handleIngest()}
                disabled={uploadState === "uploading"}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-500 px-6 py-3 text-sm font-bold text-white transition hover:bg-indigo-600 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 dark:disabled:bg-slate-700"
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
          <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        <section className="grid gap-0 overflow-hidden rounded-[28px] border border-slate-200 bg-white/95 dark:border-slate-800/80 dark:bg-slate-950/80 xl:grid-cols-[380px_minmax(0,1fr)]">
          <div className="border-b border-slate-200 bg-slate-50/90 dark:border-slate-800/80 dark:bg-slate-950/90 xl:border-b-0 xl:border-r">
            <div className="border-b border-slate-200 p-4 dark:border-slate-800/80">
              <div className="relative">
                <Search
                  size={14}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500"
                />
                <input
                  className="w-full rounded-xl border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-400 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-100 dark:placeholder:text-slate-500"
                  placeholder="Search keys or content..."
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>
            </div>

            <div className="max-h-[640px] overflow-y-auto">
              {loading && entries.length === 0 ? (
                <div className="flex h-36 flex-col items-center justify-center text-sm text-slate-500">
                  <RefreshCw size={20} className="mb-2 animate-spin opacity-50" />
                  Loading memory store…
                </div>
              ) : entries.length === 0 ? (
                <div className="flex h-36 flex-col items-center justify-center text-sm text-slate-500">
                  <Database size={24} className="mb-2 opacity-30" />
                  {search ? "No results" : "No memory entries yet"}
                </div>
              ) : (
                entries.map((entry) => (
                  <div
                    key={entry.id}
                    className={clsx(
                      "border-b border-slate-200 transition hover:bg-slate-50 dark:border-slate-800/60 dark:hover:bg-slate-900/80",
                      selected?.id === entry.id && "bg-indigo-500/10"
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
                            <span className="truncate font-mono text-xs text-slate-700 dark:text-slate-200">{entry.key}</span>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                            <span>{entry.workflowName ?? entry.workflowId ?? "Knowledge Ingest"}</span>
                            <span>·</span>
                            <Clock size={10} />
                            <span>{timeAgo(entry.updatedAt)}</span>
                            {entry.ttlSeconds && (
                              <>
                                <span>·</span>
                                <span className="text-amber-300">{ttlLabel(entry.ttlSeconds)}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDelete(entry.id)}
                        className="shrink-0 rounded-lg p-1 text-slate-500 transition hover:bg-red-500/10 hover:text-red-400"
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
                    <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Selected Entry
                    </p>
                    <h2 className="break-all font-mono text-lg font-semibold text-slate-900 dark:text-slate-100">
                      {selected.key}
                    </h2>
                  </div>
                  <button
                    onClick={() => void handleDelete(selected.id)}
                    className="inline-flex items-center gap-2 rounded-xl border border-red-500/30 px-3 py-2 text-sm text-red-300 transition hover:bg-red-500/10"
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
                    <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 md:col-span-2 dark:border-amber-500/30 dark:bg-amber-500/10">
                      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-800 dark:text-amber-200">
                        Expires At
                      </div>
                      <div className="mt-2 text-sm text-amber-900 dark:text-amber-100">
                        {new Date(selected.expiresAt).toLocaleString()}
                      </div>
                    </div>
                  ) : null}
                </div>

                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Value
                  </label>
                  <pre className="overflow-x-auto rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-xs leading-relaxed text-emerald-700 dark:border-slate-800 dark:bg-slate-950 dark:text-emerald-300">
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
              <div className="flex h-full flex-col items-center justify-center text-center text-slate-500">
                <Database size={40} className="mb-4 opacity-30" />
                <p className="text-sm text-slate-500 dark:text-slate-400">Select a memory entry to inspect the ingested payload.</p>
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
    <div className="rounded-2xl border border-slate-200 bg-white/95 p-4 dark:border-slate-800/90 dark:bg-slate-950/60">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
        {icon}
        {label}
      </div>
      <div className="text-2xl font-semibold text-slate-900 dark:text-slate-100">{value}</div>
      {helper ? <div className="mt-1 text-xs text-slate-500">{helper}</div> : null}
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
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800/90 dark:bg-slate-900/70">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className={clsx("mt-2 text-sm text-slate-800 dark:text-slate-100", mono && "font-mono")}>{value}</div>
    </div>
  );
}
