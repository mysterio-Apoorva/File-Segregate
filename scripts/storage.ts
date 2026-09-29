import {
  S3Client,
  PutBucketCorsCommand,
  HeadBucketCommand,
} from "@aws-sdk/client-s3";
import { mkdir } from "node:fs/promises";
if (process.env.STORAGE_DRIVER === "local") {
  if (process.env.VERCEL)
    throw new Error("Local storage is not persistent on Vercel.");
  await mkdir(process.env.LOCAL_STORAGE_PATH || ".runtime/storage", {
    recursive: true,
    mode: 0o700,
  });
  console.log("Local file storage ready. No S3 credentials required.");
} else {
  const required = [
    "S3_ENDPOINT",
    "S3_REGION",
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
    "S3_BUCKET",
    "APP_URL",
  ];
  for (const key of required)
    if (!process.env[key]) throw new Error(`Missing ${key}`);
  const client = new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID!,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
    },
  });
  await client.send(new HeadBucketCommand({ Bucket: process.env.S3_BUCKET }));
  try {
    await client.send(
      new PutBucketCorsCommand({
        Bucket: process.env.S3_BUCKET,
        CORSConfiguration: {
          CORSRules: [
            {
              AllowedOrigins: [new URL(process.env.APP_URL!).origin],
              AllowedMethods: ["PUT", "GET", "HEAD"],
              AllowedHeaders: ["*"],
              ExposeHeaders: ["ETag"],
              MaxAgeSeconds: 3600,
            },
          ],
        },
      }),
    );
    console.log("Private bucket reachable; CORS configured.");
  } catch (error) {
    console.error(
      "Bucket reachable, but provider does not allow S3 CORS configuration. Supabase manages CORS automatically; for other providers set PUT/GET/HEAD CORS in their dashboard.",
      error instanceof Error ? error.message : "CORS error",
    );
    process.exitCode = 1;
  }
}
