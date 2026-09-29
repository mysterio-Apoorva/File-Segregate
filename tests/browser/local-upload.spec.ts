import { test, expect } from "@playwright/test";
test("local HTTP uploads enforce ownership, signed links, sizes and immutability", async ({
  request,
  baseURL,
}, testInfo) => {
  test.skip(
    process.env.STORAGE_DRIVER !== "local" ||
      testInfo.project.name !== "desktop",
    "Local storage configuration required; exercise once to respect session budgets.",
  );
  const bytes = Buffer.from(
    "Population ecology notes for a local storage test.",
  );
  const created = await request.post("/api/sessions", {
    headers: { Origin: baseURL! },
    data: { files: [{ name: "local-test.txt", size: bytes.length }] },
  });
  expect(created.status(), await created.text()).toBe(201);
  const cookie = created.headers()["set-cookie"].split(";")[0];
  const session = (await created.json()) as {
    id: string;
    uploads: { url: string }[];
  };
  const headers = {
    Origin: baseURL!,
    Cookie: cookie,
    "Content-Type": "application/octet-stream",
  };
  try {
    const unauthorized = await request.put(session.uploads[0].url, {
      headers: { Origin: baseURL!, Cookie: "" },
      data: bytes,
    });
    expect(unauthorized.status()).toBe(403);
    const invalid = new URL(session.uploads[0].url);
    invalid.searchParams.set("signature", "tampered");
    expect(
      (
        await request.put(invalid.toString(), { headers, data: bytes })
      ).status(),
    ).toBe(403);
    expect(
      (
        await request.put(session.uploads[0].url, {
          headers,
          data: Buffer.from("short"),
        })
      ).status(),
    ).toBe(400);
    const uploaded = await request.put(session.uploads[0].url, {
      headers,
      data: bytes,
    });
    expect(uploaded.status(), await uploaded.text()).toBe(200);
    expect(
      (
        await request.put(session.uploads[0].url, { headers, data: bytes })
      ).status(),
    ).toBe(409);
  } finally {
    await request.delete(`/api/sessions/${session.id}`, {
      headers: { Origin: baseURL!, Cookie: cookie },
    });
  }
  expect(
    (
      await request.put(session.uploads[0].url, { headers, data: bytes })
    ).status(),
  ).toBe(409);
});
