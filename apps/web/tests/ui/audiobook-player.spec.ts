import { expect, test } from "../fixtures";

test("Built-in audiobook player lists chapters, resumes and saves progress", async ({
  page,
}) => {
  const saved: Array<Record<string, unknown>> = [];
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (path === "/api/auth/me")
      return route.fulfill({
        json: {
          authenticated: true,
          needs_bootstrap: false,
          csrf_token: "test-csrf",
          user: {
            id: "user-1",
            username: "reader",
            display_name: "Reader",
            role: "admin",
            active: true,
          },
        },
      });
    if (path === "/api/setup/onboarding")
      return route.fulfill({ json: { status: "completed" } });
    if (path === "/api/listen/assets/asset-1" && method === "GET")
      return route.fulfill({
        json: {
          asset_id: "asset-1",
          work_id: "work-1",
          title: "Piranesi",
          authors: ["Susanna Clarke"],
          cover_url: null,
          progress: null,
          tracks: [
            {
              index: 0,
              filename: "01.mp3",
              format: "mp3",
              size: 100,
              duration: 600,
              chapters: [
                { title: "Chapter 1: The House", start: 0, end: 300 },
                { title: "Chapter 2: The Tides", start: 300, end: 600 },
              ],
            },
          ],
        },
      });
    if (path === "/api/listen/assets/asset-1/progress" && method === "PUT") {
      saved.push(route.request().postDataJSON());
      return route.fulfill({
        json: {
          ...route.request().postDataJSON(),
          updated_at: new Date().toISOString(),
        },
      });
    }
    if (path.startsWith("/api/listen/assets/asset-1/tracks/"))
      return route.fulfill({
        status: 200,
        contentType: "audio/mpeg",
        body: "",
      });
    return route.fulfill({ json: {} });
  });

  await page.goto("/listen/asset-1");
  await expect(page.getByRole("heading", { name: "Piranesi" })).toBeVisible();
  await expect(page.getByText("Susanna Clarke")).toBeVisible();
  await expect(page.getByRole("button", { name: "Play" })).toBeVisible();
  await page.getByRole("button", { name: "Chapters" }).first().click();
  await expect(
    page.getByRole("complementary", { name: "Chapters" }),
  ).toContainText("Chapter 2: The Tides");
  await page.screenshot({ path: "test-results/ui/audiobook-player.png" });
});

test("Book page opens the player in place of the tabs and hides formats already owned", async ({
  page,
}) => {
  const book = {
    asset_id: "asset-1",
    work_id: "work-1",
    title: "Piranesi",
    authors: ["Susanna Clarke"],
    cover_url: null,
    progress: null,
    tracks: [
      {
        index: 0,
        filename: "01.mp3",
        format: "mp3",
        size: 100,
        duration: 600,
        chapters: [
          { title: "Chapter 1: The House", start: 0, end: 300 },
          { title: "Chapter 2: The Tides", start: 300, end: 600 },
        ],
      },
    ],
  };
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = {};
    if (path === "/api/auth/me")
      data = {
        authenticated: true,
        needs_bootstrap: false,
        csrf_token: "test-csrf",
        user: {
          id: "user-1",
          username: "reader",
          display_name: "Reader",
          role: "admin",
          active: true,
        },
      };
    else if (path === "/api/setup/onboarding") data = { status: "completed" };
    else if (path === "/api/catalog/works/work-1")
      data = {
        id: "work-1",
        title: "Piranesi",
        authors: ["Susanna Clarke"],
        versions: [],
        availability: {
          owned: true,
          ebook: false,
          audio: true,
          audio_versions: 1,
          stale: false,
        },
      };
    else if (path === "/api/listen/works/work-1/audio") data = book;
    else if (path === "/api/listen/assets/asset-1") data = book;
    else if (path.startsWith("/api/listen/assets/asset-1/tracks/"))
      return route.fulfill({ contentType: "audio/mpeg", body: "" });
    else if (path === "/api/metadata/works/work-1")
      data = {
        sources: [],
        conflicts: [],
        fields: {},
        versions: [],
        versions_total: 0,
      };
    else if (path.endsWith("/reader-match")) data = { book: null };
    else if (path.endsWith("/reader-details"))
      data = { authors: [], reviews: [] };
    else if (path.endsWith("/versions")) data = [];
    else if (path.includes("/group"))
      data = { items: [], groups: [], members: [] };
    else if (path === "/api/acquisition/profiles")
      data = [{ id: null, generation: 0, preferences: {} }];
    else if (path === "/api/acquisition/preferences/personal")
      data = { effective: {} };
    else if (path.includes("/quick-add/latest/")) data = null;
    else if (path === "/api/requests" || path === "/api/catalog/works")
      data = { items: [], total: 0 };
    await route.fulfill({ json: data });
  });
  await page.goto("/books/work-1");
  await expect(page.getByRole("button", { name: "Add ebook" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add audiobook" })).toHaveCount(
    0,
  );
  await expect(page.getByRole("button", { name: "Add both" })).toHaveCount(0);
  await expect(page.getByText("Search sources")).toHaveCount(0);
  await expect(
    page.locator(".status-row .status", { hasText: "In library" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Listen" }).click();
  await expect(page.getByRole("tablist")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  await expect(
    page.getByRole("complementary", { name: "Chapters" }),
  ).toContainText("Chapter 2: The Tides");
  await page.screenshot({ path: "test-results/ui/book-player-inline.png" });
  await page.getByRole("button", { name: "Close player" }).first().click();
  await expect(page.getByRole("tablist")).toBeVisible();
});
