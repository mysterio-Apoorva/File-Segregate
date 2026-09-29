"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import {
  Upload,
  FolderPlus,
  FileText,
  X,
  ArrowRight,
  Sparkles,
  Check,
  LoaderCircle,
  Download,
  Search,
  AlertCircle,
  RotateCcw,
  ShieldCheck,
  FolderOpen,
} from "lucide-react";
import {
  MAX_FILES,
  MAX_FILE_BYTES,
  MAX_BATCH_BYTES,
  EXTENSIONS,
} from "@/lib/limits";
import type { FileRow, SessionView } from "@/lib/schemas";
import { FolderTreeView } from "./tree";
import { FileDetails, formatBytes } from "./file-details";
type Selection = { id: string; file: File; progress: number; error?: string };
type UploadTicket = { id: string; name: string; url: string };
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body = await response.json();
  if (!response.ok)
    throw new Error(
      body.error || "The service could not complete your request.",
    );
  return body as T;
}
function upload(
  file: File,
  url: string,
  onProgress: (progress: number) => void,
  signal: AbortSignal,
) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    if (signal.aborted) return reject(new Error("Upload cancelled."));
    signal.addEventListener("abort", abort, { once: true });
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.timeout = 300000;
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable)
        onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      signal.removeEventListener("abort", abort);
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(100);
        resolve();
      } else
        reject(new Error("Upload failed. Check your connection and retry."));
    };
    xhr.onerror = () => {
      signal.removeEventListener("abort", abort);
      reject(
        new Error(
          "Upload could not reach storage. Check your connection and try again.",
        ),
      );
    };
    xhr.ontimeout = () => {
      signal.removeEventListener("abort", abort);
      reject(new Error("Upload timed out. Please retry."));
    };
    xhr.onabort = () => {
      signal.removeEventListener("abort", abort);
      reject(new Error("Upload cancelled."));
    };
    xhr.send(file);
  });
}
async function droppedFiles(items: DataTransferItemList): Promise<File[]> {
  const result: File[] = [];
  async function visit(entry: FileSystemEntry): Promise<void> {
    if (result.length > MAX_FILES) return;
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) =>
        (entry as FileSystemFileEntry).file(resolve, reject),
      );
      result.push(file);
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      while (result.length <= MAX_FILES) {
        const entries = await new Promise<FileSystemEntry[]>(
          (resolve, reject) => reader.readEntries(resolve, reject),
        );
        if (!entries.length) break;
        for (const child of entries) await visit(child);
      }
    }
  }
  const entries = Array.from(items)
    .filter((i) => i.kind === "file")
    .map((i) => ({ entry: i.webkitGetAsEntry?.(), file: i.getAsFile() }));
  for (const item of entries) {
    if (item.entry) await visit(item.entry);
    else if (item.file) result.push(item.file);
  }
  return result;
}
const statusLabels: Record<string, string> = {
  queued: "Queued",
  uploading: "Uploading",
  extracting: "Reading content",
  analyzing: "Gemini is analyzing",
  classified: "Classified",
  "duplicate-check": "Checking duplicates",
  ready: "Ready",
  failed: "Processing failed",
};
const terminal = ["complete", "failed", "cancelled"];
export function Library() {
  const [selection, setSelection] = useState<Selection[]>([]);
  const [id, setId] = useState<string | null>(null);
  const [view, setView] = useState<SessionView | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [configured, setConfigured] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState<FileRow | null>(null);
  const [downloading, setDownloading] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const saved = localStorage.getItem("studysort-session");
    if (saved) setId(saved);
    fetch("/api/health")
      .then((r) => r.json())
      .then((r) => setConfigured(r.configured))
      .catch(() => undefined);
    return () => controller.current?.abort();
  }, []);
  const refresh = useCallback(async (sessionId: string) => {
    const result = await api<SessionView>(`/api/sessions/${sessionId}`);
    setView(result);
    return result;
  }, []);
  useEffect(() => {
    if (!id) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const result = await api<SessionView>(`/api/sessions/${id}`);
        if (stopped) return;
        setView(result);
        if (!terminal.includes(result.session.status))
          timer = setTimeout(poll, 2000);
      } catch (err) {
        if (!stopped) {
          setError(
            err instanceof Error ? err.message : "Could not refresh progress.",
          );
          timer = setTimeout(poll, 6000);
        }
      }
    }
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [id]);
  function add(files: File[]) {
    setError("");
    if (files.length + selection.length > MAX_FILES) {
      setError(`Choose at most ${MAX_FILES} files per session.`);
      return;
    }
    const invalid = files.find((f) => f.size === 0 || f.size > MAX_FILE_BYTES);
    if (invalid) {
      setError(`${invalid.name}: files must be nonempty and at most 25 MB.`);
      return;
    }
    if (
      [...files, ...selection.map((s) => s.file)].reduce(
        (sum, f) => sum + f.size,
        0,
      ) > MAX_BATCH_BYTES
    ) {
      setError("Choose at most 500 MB per session.");
      return;
    }
    setSelection((previous) => [
      ...previous,
      ...files.map((file) => ({ id: crypto.randomUUID(), file, progress: 0 })),
    ]);
  }
  async function start() {
    setBusy(true);
    setError("");
    const abort = new AbortController();
    controller.current = abort;
    try {
      const session = await api<{ id: string; uploads: UploadTicket[] }>(
        "/api/sessions",
        {
          method: "POST",
          body: JSON.stringify({
            files: selection.map((s) => ({
              name: s.file.name,
              size: s.file.size,
            })),
          }),
          signal: abort.signal,
        },
      );
      setId(session.id);
      localStorage.setItem("studysort-session", session.id);
      let next = 0;
      let failed = false;
      await Promise.all(
        Array.from({ length: Math.min(4, selection.length) }, async () => {
          while (next < selection.length && !abort.signal.aborted) {
            const index = next++;
            const item = selection[index];
            try {
              await upload(
                item.file,
                session.uploads[index].url,
                (progress) =>
                  setSelection((previous) =>
                    previous.map((s) =>
                      s.id === item.id
                        ? { ...s, progress, error: undefined }
                        : s,
                    ),
                  ),
                abort.signal,
              );
            } catch (err) {
              failed = true;
              setSelection((previous) =>
                previous.map((s) =>
                  s.id === item.id
                    ? {
                        ...s,
                        error:
                          err instanceof Error ? err.message : "Upload failed",
                      }
                    : s,
                ),
              );
            }
          }
        }),
      );
      if (abort.signal.aborted) return;
      if (failed)
        throw new Error(
          "Some files did not upload. Start a new session to retry; your selected files are still available below.",
        );
      await api(`/api/sessions/${session.id}/start`, {
        method: "POST",
        body: "{}",
        signal: abort.signal,
      });
      await refresh(session.id);
    } catch (err) {
      if (!abort.signal.aborted)
        setError(
          err instanceof Error ? err.message : "Could not start organization.",
        );
    } finally {
      setBusy(false);
    }
  }
  async function cancel() {
    controller.current?.abort();
    if (!id) return;
    try {
      await api(`/api/sessions/${id}`, { method: "DELETE" });
      await refresh(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cancellation failed.");
    }
  }
  function reset() {
    controller.current?.abort();
    localStorage.removeItem("studysort-session");
    setId(null);
    setView(null);
    setSelection([]);
    setSelected(null);
    setSearch("");
    setFilter("all");
    setError("");
  }
  async function download() {
    setDownloading(true);
    setError("");
    try {
      const result = await api<{ url: string }>(`/api/sessions/${id}/download`);
      window.location.assign(result.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed.");
    } finally {
      setDownloading(false);
    }
  }
  const status = view?.session.status;
  const working = Boolean(
    id && status && ["queued", "processing", "archiving"].includes(status),
  );
  const complete = status === "complete";
  const files = view?.files || [];
  const finished = files.filter((f) =>
    ["ready", "failed"].includes(f.status),
  ).length;
  const progress = complete
    ? 100
    : files.length
      ? Math.floor((finished / files.length) * 90)
      : 0;
  const activeFile = files.find((f) =>
    ["extracting", "analyzing", "classified", "duplicate-check"].includes(
      f.status,
    ),
  );
  const filtered = files.filter((f) => {
    const text = [
      f.original_name,
      f.analysis?.subject,
      f.analysis?.chapter,
      f.analysis?.topic,
      ...(f.analysis?.keywords || []),
    ]
      .join(" ")
      .toLowerCase();
    return (
      text.includes(search.toLowerCase()) &&
      (filter === "all" ||
        (filter === "duplicates"
          ? f.duplicate_status !== "unique"
          : f.status === "failed" || f.analysis?.needsReview))
    );
  });
  const subjects = new Set(
    files.flatMap((f) => (f.analysis?.subject ? [f.analysis.subject] : [])),
  );
  const chapters = new Set(
    files.flatMap((f) =>
      f.analysis?.chapter
        ? [`${f.analysis.subject}/${f.analysis.chapter}`]
        : [],
    ),
  );
  const topics = new Set(
    files.flatMap((f) =>
      f.analysis?.topic
        ? [`${f.analysis.subject}/${f.analysis.chapter}/${f.analysis.topic}`]
        : [],
    ),
  );
  const exact = files.filter((f) => f.duplicate_status === "exact").length,
    likely = files.filter((f) => f.duplicate_status === "likely").length;
  return (
    <section
      className="workspace"
      id="workspace"
      aria-label="Study material organizer"
    >
      <div className="workspace-heading">
        <div>
          <div className="eyebrow">YOUR STUDY SPACE, REIMAGINED</div>
          <h2>
            {complete
              ? "Meet your organized library."
              : "Good learning starts with a little order."}
          </h2>
          <p>
            {complete
              ? "Explore your folders, inspect the details, and take it all with you."
              : "Bring the material. We’ll make sense of the mess."}
          </p>
        </div>
        <span className="private-label">
          <ShieldCheck size={15} /> Private session
        </span>
      </div>
      <div className="workspace-card">
        <div className="steps">
          {[
            "Upload material",
            "AI organizes",
            "Review library",
            "Download ZIP",
          ].map((step, i) => (
            <div
              key={step}
              className={
                (complete ? i <= 2 : working ? i <= 1 : i === 0)
                  ? "step active"
                  : "step"
              }
            >
              <span>
                {complete && i < 2 ? <Check size={13} /> : `0${i + 1}`}
              </span>
              {step}
            </div>
          ))}
        </div>
        {!configured && (
          <div className="notice warning">
            <AlertCircle size={18} />
            <span>
              This installation needs configuration before it can process files.
              Follow README.md to set up Gemini and your selected storage mode.
            </span>
          </div>
        )}
        {error && (
          <div className="notice error" role="alert">
            <AlertCircle size={18} />
            <span>{error}</span>
            <button
              className="icon-button"
              onClick={() => setError("")}
              aria-label="Dismiss error"
            >
              <X size={16} />
            </button>
          </div>
        )}
        {(!id || status === "uploading" || (busy && !working)) && (
          <div className="upload-stage">
            {!id && (
              <>
                <input
                  ref={input}
                  type="file"
                  multiple
                  className="sr-only"
                  onChange={(e) => {
                    add(Array.from(e.target.files || []));
                    e.target.value = "";
                  }}
                  aria-label="Select study files"
                />
                <input
                  ref={folderInput}
                  type="file"
                  multiple
                  {...{ webkitdirectory: "", directory: "" }}
                  className="sr-only"
                  onChange={(e) => {
                    add(Array.from(e.target.files || []));
                    e.target.value = "";
                  }}
                  aria-label="Select study folder"
                />
                <div
                  className={`dropzone ${dragging ? "dragging" : ""}`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={async (e) => {
                    e.preventDefault();
                    setDragging(false);
                    try {
                      const list = e.dataTransfer.items.length
                        ? await droppedFiles(e.dataTransfer.items)
                        : Array.from(e.dataTransfer.files);
                      add(list);
                    } catch {
                      setError(
                        "This folder could not be read. Try the Choose folder button.",
                      );
                    }
                  }}
                >
                  <span className="upload-icon">
                    <Upload size={27} strokeWidth={1.5} />
                  </span>
                  <h3>Drop your files here</h3>
                  <p>Lecture slides, notes, question banks. All welcome.</p>
                  <div className="upload-actions">
                    <button
                      className="button primary"
                      onClick={() => input.current?.click()}
                    >
                      Choose files <ArrowRight size={15} />
                    </button>
                    <button
                      className="button secondary"
                      onClick={() => folderInput.current?.click()}
                    >
                      <FolderPlus size={16} /> Choose folder
                    </button>
                  </div>
                  <small>PDF · DOC / DOCX · PPT / PPTX · TXT · Images</small>
                  <small className="upload-limit">
                    Up to 200 files · 25 MB per file · 500 MB total
                  </small>
                </div>
              </>
            )}
            {selection.length > 0 && (
              <div className="selection">
                <div className="section-label">
                  <strong>{selection.length} files selected</strong>
                  <span>
                    {formatBytes(
                      selection.reduce((sum, s) => sum + s.file.size, 0),
                    )}{" "}
                    total
                  </span>
                </div>
                <div className="file-list">
                  {selection.map((s) => (
                    <div className="file-row" key={s.id}>
                      <FileText size={18} />
                      <div className="file-row-name">
                        <strong>{s.file.name}</strong>
                        {s.error && (
                          <small className="error-text">{s.error}</small>
                        )}
                        {!EXTENSIONS.includes(
                          s.file.name.split(".").pop()?.toLowerCase() || "",
                        ) && (
                          <small>
                            Unsupported format: will be preserved in Needs
                            Review.
                          </small>
                        )}
                      </div>
                      <span className="file-size">
                        {formatBytes(s.file.size)}
                      </span>
                      <span className="file-status">
                        {id ? `${s.progress}% uploaded` : "Ready to upload"}
                      </span>
                      {!id && (
                        <button
                          className="icon-button"
                          aria-label={`Remove ${s.file.name}`}
                          onClick={() =>
                            setSelection((previous) =>
                              previous.filter((item) => item.id !== s.id),
                            )
                          }
                        >
                          <X size={16} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {!id && (
              <div className="upload-bottom">
                <span>
                  <Sparkles size={15} /> Content-first organization, powered by
                  Gemini
                </span>
                <button
                  className="button primary"
                  onClick={start}
                  disabled={!selection.length || busy || !configured}
                >
                  {busy ? (
                    <LoaderCircle className="spin" size={17} />
                  ) : (
                    <Sparkles size={16} />
                  )}{" "}
                  Organize with Gemini
                </button>
              </div>
            )}
            {id && (
              <div className="upload-bottom">
                <span>
                  {busy
                    ? "Uploading your originals to private storage…"
                    : "This upload session has not started processing."}
                </span>
                <button
                  className="button secondary"
                  onClick={busy ? cancel : reset}
                >
                  {busy ? "Cancel upload" : "Start a new session"}
                </button>
              </div>
            )}
          </div>
        )}
        {working && (
          <div className="processing">
            <div className="processing-icon">
              <Sparkles size={28} />
            </div>
            <h3>
              {status === "archiving"
                ? "Packing your organized library"
                : status === "queued"
                  ? "Your material is in the queue"
                  : "Making sense of your material"}
            </h3>
            <p>
              {status === "archiving"
                ? "Streaming the original files into your ZIP, with a transparent manifest."
                : activeFile
                  ? `${statusLabels[activeFile.status]}: ${activeFile.original_name}`
                  : "Your session keeps processing even if you close this tab."}
            </p>
            <div className="progress-label">
              <span>
                {finished} / {files.length} files processed
              </span>
              <strong>{progress}%</strong>
            </div>
            <progress
              value={progress}
              max={100}
              aria-label="Organization progress"
            />
            <div className="processing-note">
              <span>
                {status === "archiving"
                  ? "Final 10%: archive generation"
                  : "Progress reflects completed files; large documents can take longer."}
              </span>
              <button className="text-button" onClick={cancel}>
                Cancel processing
              </button>
            </div>
            <div className="file-list processing-list">
              {files.map((f) => (
                <div className="file-row" key={f.id}>
                  {f.status === "ready" ? (
                    <Check size={17} className="success-text" />
                  ) : f.status === "failed" ? (
                    <AlertCircle size={17} className="error-text" />
                  ) : (
                    <FileText size={17} />
                  )}
                  <span className="file-row-name">{f.original_name}</span>
                  <span className="file-status">{statusLabels[f.status]}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {complete && (
          <div className="results">
            <div className="results-top">
              <div>
                <span className="complete-tag">
                  <Check size={14} /> Organization complete
                </span>
                <h3>A place for every piece of knowledge.</h3>
              </div>
              <button
                className="button primary"
                disabled={!view?.archiveReady || downloading}
                onClick={download}
              >
                {downloading ? (
                  <LoaderCircle size={17} className="spin" />
                ) : (
                  <Download size={17} />
                )}{" "}
                Download organized ZIP
              </button>
            </div>
            <div className="stats">
              {[
                [files.length, "files preserved"],
                [subjects.size, "subjects discovered"],
                [chapters.size, "chapters"],
                [topics.size, "topics"],
              ].map(([n, label]) => (
                <div key={label}>
                  <strong>{n}</strong>
                  <span>{label}</span>
                </div>
              ))}
            </div>
            <div className="duplicate-summary">
              <LayersIcon />
              <span>
                {files.length - exact - likely} without detected duplicates
              </span>
              <span>{exact} exact duplicates</span>
              <span>{likely} likely duplicates</span>
              <small>All originals preserved</small>
            </div>
            {files.some(f => f.status === "failed") && (
              <div className="notice warning" role="alert">
                <AlertCircle size={18} />
                <span>{files.filter(f => f.status === "failed").length} files could not be analyzed. Their originals are preserved in Needs Review. Select a file to see the processing error; this is not an AI classification.</span>
              </div>
            )}
            {view?.session.warning && (
              <div className="notice warning">{view.session.warning}</div>
            )}
            <div className="results-toolbar">
              <label className="search">
                <Search size={17} />
                <input
                  placeholder="Search files, subjects, or topics…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label="Search organized files"
                />
              </label>
              <select
                aria-label="Filter files"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                <option value="all">All files</option>
                <option value="duplicates">Duplicates</option>
                <option value="review">Needs review</option>
              </select>
            </div>
            <div
              className={`results-browser ${selected ? "with-details" : ""}`}
            >
              <div>
                <div className="tree-header">
                  <FolderOpen size={17} /> Organized Study Material{" "}
                  <small>{filtered.length} files</small>
                </div>
                {filtered.length ? (
                  <FolderTreeView
                    files={filtered}
                    onSelect={setSelected}
                    selected={selected?.id}
                  />
                ) : (
                  <p className="empty-state">No files match your search.</p>
                )}
              </div>
              {selected && (
                <FileDetails
                  file={selected}
                  files={files}
                  close={() => setSelected(null)}
                />
              )}
            </div>
            <div className="results-bottom">
              <span>
                Download before{" "}
                {view && new Date(view.session.expires_at).toLocaleString()}.
              </span>
              <button className="text-button" onClick={reset}>
                <RotateCcw size={14} /> Start a new organization
              </button>
            </div>
          </div>
        )}
        {(status === "failed" || status === "cancelled") && (
          <div className="empty-state">
            <AlertCircle size={30} />
            <h3>
              {status === "cancelled"
                ? "Organization cancelled"
                : "Organization could not finish"}
            </h3>
            <p>
              {view?.session.error ||
                "Any in-flight analysis will stop at the next checkpoint. Stored files will be cleaned up after expiration."}
            </p>
            <button className="button primary" onClick={reset}>
              Start a new organization
            </button>
          </div>
        )}
        {id && !view && !busy && (
          <div className="empty-state">
            <LoaderCircle className="spin" size={24} />
            <p>Loading your session…</p>
            <button className="text-button" onClick={reset}>
              Start a new session
            </button>
          </div>
        )}
      </div>
      <div className="workspace-footnote">
        <ShieldCheck size={14} /> No login. No manual categories. Just your
        material, understood.
      </div>
    </section>
  );
}
function LayersIcon() {
  return <FileText size={16} />;
}
