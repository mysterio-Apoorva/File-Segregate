import { serve } from "inngest/next";
import { inngest } from "@/lib/jobs/client";
import { organize, maintenance, processDocument } from "@/lib/jobs/functions";
export const runtime = "nodejs";
export const maxDuration = 800;
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [organize, processDocument, maintenance],
});
