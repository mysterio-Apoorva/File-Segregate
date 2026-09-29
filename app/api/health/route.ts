import { env } from "@/lib/config";
export function GET() {
  try {
    env();
    return Response.json({ configured: true });
  } catch {
    return Response.json(
      {
        configured: false,
        message:
          "Cloud services are not configured yet. Follow the setup instructions in README.md.",
      },
      { status: 503 },
    );
  }
}
