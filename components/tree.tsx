"use client";
import { ChevronRight, FileText, Folder } from "lucide-react";
import type { FileRow } from "@/lib/schemas";
type Node = { folders: Map<string, Node>; files: FileRow[] };
export function buildTree(files: FileRow[]): Node {
  const root: Node = { folders: new Map(), files: [] };
  for (const file of files) {
    const parts = (
      file.organized_path || `Needs Review/${file.original_name}`
    ).split("/");
    let node = root;
    for (const part of parts.slice(0, -1)) {
      if (!node.folders.has(part))
        node.folders.set(part, { folders: new Map(), files: [] });
      node = node.folders.get(part)!;
    }
    node.files.push(file);
  }
  return root;
}
function Branch({
  node,
  onSelect,
  selected,
}: {
  node: Node;
  onSelect: (f: FileRow) => void;
  selected?: string;
}) {
  return (
    <>
      {[...node.folders.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, child]) => (
          <details key={name} open className="tree-folder">
            <summary>
              <ChevronRight size={14} className="chevron" />
              <Folder size={17} />
              <span>{name}</span>
            </summary>
            <div className="tree-children">
              <Branch node={child} onSelect={onSelect} selected={selected} />
            </div>
          </details>
        ))}
      {node.files.map((file) => (
        <button
          key={file.id}
          onClick={() => onSelect(file)}
          className={`tree-file ${selected === file.id ? "selected" : ""}`}
        >
          <FileText size={16} />
          <span>
            {file.organized_path?.split("/").pop() || file.original_name}
          </span>
          {(file.status === "failed" || file.analysis?.needsReview) && (
            <span className="review-dot" aria-label="Needs review" />
          )}
          {file.duplicate_status !== "unique" && (
            <small>{file.duplicate_status}</small>
          )}
        </button>
      ))}
    </>
  );
}
export function FolderTreeView({
  files,
  onSelect,
  selected,
}: {
  files: FileRow[];
  onSelect: (f: FileRow) => void;
  selected?: string;
}) {
  return (
    <div className="file-tree">
      <Branch node={buildTree(files)} onSelect={onSelect} selected={selected} />
    </div>
  );
}
