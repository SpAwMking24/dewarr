import { expect, test } from "./fixtures";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("activity requests preserve independent reasons and route missing media to the saved request", async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  execFileSync("uv", ["run", "python", "scripts/e2e_auth_budget.py"], {
    cwd: fileURLToPath(new URL("../../../", import.meta.url)),
    stdio: "pipe",
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill("reader");
  await page
    .getByLabel("Password", { exact: true })
    .fill("browser test password");
  if (await page.getByLabel("Your name").isVisible()) {
    await page.getByLabel("Your name").fill("Test Reader");
    await page.getByRole("button", { name: "Create administrator" }).click();
    await page
      .getByRole("button", { name: "Finish later", exact: true })
      .click();
  } else {
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  }
  await expect(
    page.getByRole("navigation", { name: "Main navigation" }),
  ).toBeVisible();
  const auth = await (await page.request.get("/api/auth/me")).json();
  const headers = {
    "X-CSRF-Token": auth.csrf_token,
    Origin: "http://127.0.0.1:8001",
  };
  async function post(url: string, data: unknown) {
    const response = await page.request.post(url, {
      headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
      data,
    });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  }
  const work = await post("/api/catalog/works", {
    title: "Activity Journey Alpha",
    authors: ["Activity Author"],
  });
  const saved = await post("/api/requests", {
    work_id: work.id,
    specification: { mode: "audio" },
  });
  // Exercise receipt cache invalidation without requiring a real download route.
  // The API integration suite separately checks withdrawal of persisted receipts.
  await page.route(
    `**/api/requests/quick-add/latest/${work.id}`,
    async (route) => {
      const request = await (
        await page.request.get(`/api/requests/${saved.request.id}`)
      ).json();
      await route.fulfill({
        json: request.reasons.some(
          (reason: { active: boolean }) => reason.active,
        )
          ? {
              id: "withdrawal-receipt",
              request_id: saved.request.id,
              status: "held",
              message: "No ready torrent download route",
              source_checks: [],
            }
          : null,
      });
    },
  );
  await page.goto(`/books/${work.id}`);
  await expect(
    page.getByRole("region", { name: "Quick add progress" }),
  ).toBeVisible();
  const list = await post("/api/lists", { name: "Activity follow list" });
  // Entry creation returns a normal list response and does not activate automation.
  const entry = await page.request.post(`/api/lists/${list.id}/entries`, {
    headers,
    data: { work_id: work.id },
  });
  expect(entry.ok()).toBe(true);
  const listed = await post("/api/requests", {
    work_id: work.id,
    specification: { mode: "audio" },
    reason: { list_id: list.id },
  });
  expect(listed.request.id).toBe(saved.request.id);
  for (let i = 0; i < 10; i++) {
    const extra = await post("/api/catalog/works", {
      title: `Activity pagination ${i}`,
      authors: [],
    });
    await post("/api/requests", {
      work_id: extra.id,
      specification: { mode: "ebook" },
    });
  }
  const transfers = await (
    await page.request.get("/api/acquisition/downloads")
  ).json();
  const inventory = await (
    await page.request.get("/api/library/assets")
  ).json();
  const writes: string[] = [];
  page.on("request", (request) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method()))
      writes.push(request.url());
  });
  await page.getByRole("link", { name: "Requests", exact: true }).click();
  const requests = page.getByRole("region", {
    name: "Requests",
    exact: true,
  });
  await expect
    .poll(() => requests.locator("tbody").count())
    .toBeGreaterThanOrEqual(10);
  await requests.locator("tbody").last().scrollIntoViewIfNeeded();
  const card = requests.getByRole("rowgroup", {
    name: "Activity Journey Alpha request",
    exact: true,
  });
  await expect(card).toBeVisible();
  await expect(card).toContainText("Audiobook");
  await expect(card.getByText("Wanted", { exact: true })).toBeVisible();
  await card
    .getByRole("button", { name: "Cancel request", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Cancel request" })
    .getByRole("button", { name: "Yes, cancel request", exact: true })
    .click();
  await expect(
    card.getByRole("link", { name: "Choose download", exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () => {
      const after = await (
        await page.request.get(`/api/requests/${saved.request.id}`)
      ).json();
      return after.reasons.some(
        (reason: { active: boolean; kind: string }) =>
          reason.kind === "manual" && reason.active,
      );
    })
    .toBe(false);
  expect(
    (await (await page.request.get("/api/acquisition/downloads")).json()).total,
  ).toBe(transfers.total);
  expect(
    (await (await page.request.get("/api/library/assets")).json()).total,
  ).toBe(inventory.total);
  expect(errors).toEqual([]);
});
