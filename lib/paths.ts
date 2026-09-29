import type { Analysis } from "./schemas";
function truncateBytes(text: string, limit: number) {
  let result = "";
  for (const character of text) {
    if (new TextEncoder().encode(result + character).length > limit) break;
    result += character;
  }
  return result;
}
export function safeSegment(input: string, maxLength = 90): string {
  let value = input
    .normalize("NFKC")
    .replace(/[\x00-\x1f\x7f<>:"/\\|?*]/g, "_")
    .replace(/\s+/g, " ")
    .replace(/^[. ]+|[. ]+$/g, "");
  if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(value))
    value = `_${value}`;
  return truncateBytes(value, maxLength).replace(/[. ]+$/g, "") || "Untitled";
}
export function safeFileName(name: string, stemLimit = 120): string {
  const leaf = name.split(/[\\/]/).pop() || "Untitled";
  const dot = leaf.lastIndexOf(".");
  return dot > 0
    ? `${safeSegment(leaf.slice(0, dot), stemLimit)}.${safeSegment(leaf.slice(dot + 1), 12)}`
    : safeSegment(leaf, stemLimit);
}
export function folderFor(analysis: Analysis | null, failed = false): string[] {
  if (
    failed ||
    !analysis ||
    analysis.needsReview ||
    analysis.confidence < 0.6 ||
    !analysis.subject.trim()
  )
    return ["Needs Review"];
  if (!analysis.isEducationalMaterial)
    return ["Other Material", safeSegment(analysis.subject)];
  const parts = [analysis.subject];
  if (analysis.spansMultipleChapters)
    parts.push(analysis.documentType || "Multi-topic Material");
  else {
    if (analysis.chapter) parts.push(analysis.chapter);
    if (analysis.topic) parts.push(analysis.topic);
  }
  return parts
    .map((p) => safeSegment(p))
    .filter(
      (p, i, all) =>
        all.findIndex((x) => x.toLowerCase() === p.toLowerCase()) === i,
    );
}
export function allocatePaths(
  files: {
    id: string;
    original_name: string;
    analysis: Analysis | null;
    status: string;
  }[],
): Map<string, string> {
  const used = new Set<string>(["organization_manifest.json"]);
  const paths = new Map<string, string>();
  for (const file of [...files].sort((a, b) => a.id.localeCompare(b.id))) {
    const folders = folderFor(file.analysis, file.status === "failed");
    const folderBudget = folders.length === 3 ? 40 : 55;
    const safeFolders = folders.map((p) => safeSegment(p, folderBudget));
    const stemBudget = Math.max(
      50,
      205 - new TextEncoder().encode(safeFolders.join("/")).length - 14,
    );
    const base = [
      ...safeFolders,
      safeFileName(file.original_name, Math.min(120, stemBudget)),
    ].join("/");
    let candidate = base;
    let n = 1;
    while (used.has(candidate.toLowerCase())) {
      const dot = base.lastIndexOf(".");
      const hasExtension = dot > base.lastIndexOf("/");
      candidate = hasExtension
        ? `${base.slice(0, dot)} (${++n})${base.slice(dot)}`
        : `${base} (${++n})`;
    }
    used.add(candidate.toLowerCase());
    paths.set(file.id, candidate);
  }
  return paths;
}
