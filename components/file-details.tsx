import { FileText, X, AlertCircle } from "lucide-react";
import type { FileRow } from "@/lib/schemas";
export function formatBytes(bytes: number) {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
export function FileDetails({
  file,
  files,
  close,
}: {
  file: FileRow;
  files: FileRow[];
  close: () => void;
}) {
  const a = file.analysis;
  return (
    <aside className="file-details" aria-label="File details">
      <div className="details-top">
        <FileText size={24} />
        <button
          className="icon-button"
          onClick={close}
          aria-label="Close file details"
        >
          <X size={18} />
        </button>
      </div>
      <h3>{file.original_name}</h3>
      <p className="muted">
        {file.extension.toUpperCase()} · {formatBytes(file.size)}
      </p>
      {(file.error || a?.needsReview) && (
        <div className="notice warning">
          <AlertCircle size={17} />
          <span>{file.error || a?.reviewReason || "Needs review"}</span>
        </div>
      )}
      {a && (
        <>
          <p className="description">{a.description}</p>
          <dl>
            {[
              ["Subject", a.subject],
              [
                "Chapter",
                a.spansMultipleChapters ? "Multiple chapters" : a.chapter,
              ],
              ["Topic", a.topic],
              ["Subtopic", a.subtopic],
              ["Document type", a.documentType],
            ]
              .filter(([, value]) => value)
              .map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            <div>
              <dt>AI confidence estimate</dt>
              <dd>
                {Math.round(a.confidence * 100)}%{" "}
                <small>Not a calibrated probability</small>
              </dd>
            </div>
          </dl>
          <p className="explanation">{a.reasoningSummary}</p>
          {a.keywords.length > 0 && (
            <div className="keywords">
              {a.keywords.map((k) => (
                <span key={k}>{k}</span>
              ))}
            </div>
          )}
          {a.secondarySubjects.length > 0 && (
            <p className="muted">
              Also covers: {a.secondarySubjects.join(", ")}
            </p>
          )}
          {a.topicCoverage.length > 1 && (
            <p className="muted">Coverage: {a.topicCoverage.join(" · ")}</p>
          )}
        </>
      )}
      <div className="duplicate-detail">
        <strong>
          {file.duplicate_status === "exact"
            ? "Exact duplicate"
            : file.duplicate_status === "likely"
              ? "Likely content duplicate"
              : "No duplicate detected"}
        </strong>
        {file.duplicate_of && (
          <p>
            ↔{" "}
            {files.find((f) => f.id === file.duplicate_of)?.original_name ||
              "Another uploaded file"}
          </p>
        )}
        {file.duplicate_explanation && <p>{file.duplicate_explanation}</p>}
        {file.similarity !== null && (
          <small>
            Computed text-shingle similarity:{" "}
            {Math.round(file.similarity * 100)}%
          </small>
        )}
      </div>
    </aside>
  );
}
