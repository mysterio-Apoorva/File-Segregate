import { test, expect } from "@playwright/test";
import type { Analysis, FileRow } from "../../lib/schemas";
import { zip } from "../fixtures";
test("landing, file selection, removal and responsive layout", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "organized knowledge library",
  );
  await page.getByRole("link", { name: "Start organizing" }).click();
  const file = {
    name: "study.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(
      "Educational notes about population ecology and carrying capacity.",
    ),
  };
  await page
    .getByLabel("Select study files", { exact: true })
    .setInputFiles([file]);
  await expect(page.getByText("1 files selected")).toBeVisible();
  await expect(page.getByText("study.txt", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Remove study.txt" }).click();
  await expect(page.getByText("study.txt", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Organize with Gemini" }),
  ).toBeDisabled();
  const dimensions = await page.evaluate(() => ({
    page: document.documentElement.scrollWidth,
    viewport: innerWidth,
  }));
  expect(dimensions.page).toBeLessThanOrEqual(dimensions.viewport);
  expect(errors).toEqual([]);
  await page.screenshot({
    path: `.runtime/${testInfo.project.name}-workspace.png`,
    fullPage: true,
  });
});
test("rejects empty files with an understandable error", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Select study files", { exact: true }).setInputFiles([
    {
      name: "empty.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.alloc(0),
    },
  ]);
  await expect(
    page
      .getByRole("region", { name: "Study material organizer" })
      .getByRole("alert"),
  ).toContainText("nonempty");
});
test("results support search, duplicate filtering, details, folder toggles and ZIP download", async ({
  page,
}) => {
  // Browser-only API fixtures exercise interaction, not Gemini accuracy.
  const id = "c5a9b026-8125-45c2-a954-231fa9d8dcf4";
  const analysis: Analysis = {
    subject: "Ecology",
    chapter: "Population dynamics",
    topic: "Carrying capacity",
    subtopic: "",
    documentType: "Notes",
    description: "Population growth and limiting factors.",
    keywords: ["carrying capacity"],
    confidence: 0.87,
    reasoningSummary: "Content discusses population growth.",
    isEducationalMaterial: true,
    secondarySubjects: [],
    topicCoverage: ["Logistic growth"],
    spansMultipleChapters: false,
    needsReview: false,
    reviewReason: "",
  };
  const first: FileRow = {
    id: "first",
    session_id: id,
    original_name: "notes.txt",
    extension: "txt",
    size: 50,
    mime_type: "text/plain",
    storage_key: "",
    status: "ready",
    error: null,
    sha256: null,
    content_fingerprint: null,
    semantic_fingerprint: null,
    analysis,
    duplicate_status: "unique",
    duplicate_of: null,
    duplicate_explanation: null,
    similarity: null,
    organized_path: "Ecology/Population dynamics/Carrying capacity/notes.txt",
    extraction_metadata: null,
    created_at: new Date().toISOString(),
  };
  const second: FileRow = {
    ...first,
    id: "second",
    original_name: "copy.txt",
    organized_path: "Ecology/Population dynamics/Carrying capacity/copy.txt",
    duplicate_status: "exact",
    duplicate_of: "first",
    duplicate_explanation: "Identical original bytes.",
  };
  await page.addInitScript(
    (value) => localStorage.setItem("studysort-session", value),
    id,
  );
  await page.route("**/api/health", (route) =>
    route.fulfill({ json: { configured: true } }),
  );
  await page.route(`**/api/sessions/${id}`, (route) =>
    route.fulfill({
      json: {
        session: {
          id,
          status: "complete",
          created_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 86400000).toISOString(),
          error: null,
          warning: null,
        },
        files: [first, second],
        archiveReady: true,
      },
    }),
  );
  await page.route(`**/api/sessions/${id}/download`, (route) =>
    route.fulfill({ json: { url: "http://localhost:3000/test-archive.zip" } }),
  );
  const archive = await zip({
    "notes.txt": "Population growth and carrying capacity.",
  });
  await page.route("**/test-archive.zip", (route) =>
    route.fulfill({
      body: archive,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition":
          'attachment; filename="StudyMaterial_Organized.zip"',
      },
    }),
  );
  await page.goto("/");
  await expect(
    page.getByText("Organization complete", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "notes.txt", exact: true }).click();
  await expect(page.getByLabel("File details", { exact: true })).toContainText(
    "AI confidence estimate",
  );
  await expect(page.getByLabel("File details", { exact: true })).toContainText(
    "87%",
  );
  await page.getByRole("button", { name: "Close file details" }).click();
  await page.getByLabel("Search organized files").fill("not-a-topic");
  await expect(page.getByText("No files match your search.")).toBeVisible();
  await page.getByLabel("Search organized files").fill("capacity");
  await expect(
    page.getByRole("button", { name: "notes.txt", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Filter files").selectOption("duplicates");
  await expect(
    page.getByRole("button", { name: "notes.txt", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "copy.txt exact" }).click();
  await expect(page.getByLabel("File details", { exact: true })).toContainText(
    "Exact duplicate",
  );
  await page.locator("summary").filter({ hasText: "Ecology" }).click();
  await expect(
    page.getByRole("button", { name: "copy.txt exact" }),
  ).toBeHidden();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download organized ZIP" }).click();
  expect((await download).suggestedFilename()).toBe(
    "StudyMaterial_Organized.zip",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
