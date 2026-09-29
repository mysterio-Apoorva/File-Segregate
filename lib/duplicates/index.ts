import { createHash } from "node:crypto";
// A bottom-k sketch of normalized five-word shingles. Similarity is lexical Jaccard,
// never presented as an embedding score or a calibrated probability.
export function fingerprint(text: string): number[] {
  const words =
    text
      .normalize("NFKC")
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) || [];
  const hashes = new Set<number>();
  for (let i = 0; i + 4 < words.length; i++)
    hashes.add(
      createHash("sha256")
        .update(words.slice(i, i + 5).join(" "))
        .digest()
        .readUInt32BE(0),
    );
  return [...hashes].sort((a, b) => a - b).slice(0, 256);
}
export function similarity(a: number[], b: number[]): number {
  if (!a.length || !b.length) return 0;
  const bottom = [...new Set([...a, ...b])].sort((x, y) => x - y).slice(0, 256);
  const left = new Set(a),
    right = new Set(b);
  return (
    bottom.filter((x) => left.has(x) && right.has(x)).length / bottom.length
  );
}
