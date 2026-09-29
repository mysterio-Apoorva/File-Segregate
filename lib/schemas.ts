import { z } from "zod";
export const analysisSchema = z.object({
  subject: z.string().max(120),
  chapter: z.string().max(120),
  topic: z.string().max(120),
  subtopic: z.string().max(120),
  documentType: z.string().max(80),
  description: z.string().max(1500),
  keywords: z.array(z.string().max(80)).max(30),
  confidence: z.number().min(0).max(1),
  reasoningSummary: z.string().max(500),
  isEducationalMaterial: z.boolean(),
  secondarySubjects: z.array(z.string().max(120)).max(15),
  topicCoverage: z.array(z.string().max(120)).max(40),
  spansMultipleChapters: z.boolean(),
  needsReview: z.boolean(),
  reviewReason: z.string().max(500),
});
export type Analysis = z.infer<typeof analysisSchema>;
export const duplicateSchema = z.object({
  likelyDuplicate: z.boolean(),
  overlap: z.enum(["low", "medium", "high"]),
  explanation: z.string().max(600),
});
export type FileStatus =
  | "queued"
  | "uploading"
  | "extracting"
  | "analyzing"
  | "classified"
  | "duplicate-check"
  | "ready"
  | "failed";
export type SessionStatus =
  | "uploading"
  | "queued"
  | "processing"
  | "archiving"
  | "complete"
  | "cancelled"
  | "failed";
export interface FileRow {
  id: string;
  session_id: string;
  original_name: string;
  extension: string;
  size: number;
  mime_type: string;
  storage_key: string;
  status: FileStatus;
  error: string | null;
  sha256: string | null;
  content_fingerprint: string | null;
  semantic_fingerprint: number[] | null;
  analysis: Analysis | null;
  duplicate_status: "unique" | "exact" | "likely";
  duplicate_of: string | null;
  duplicate_explanation: string | null;
  similarity: number | null;
  organized_path: string | null;
  extraction_metadata: Record<string, string | number | boolean | null> | null;
  created_at: string;
}
export interface SessionRow {
  id: string;
  status: SessionStatus;
  expires_at: string;
  created_at: string;
  error: string | null;
  warning: string | null;
}
export interface SessionView {
  session: SessionRow;
  files: FileRow[];
  archiveReady: boolean;
}
export const uploadSchema = z.object({
  files: z
    .array(
      z.object({
        name: z.string().min(1).max(255),
        size: z
          .number()
          .int()
          .positive()
          .max(25 * 1024 * 1024),
      }),
    )
    .min(1)
    .max(200),
});
