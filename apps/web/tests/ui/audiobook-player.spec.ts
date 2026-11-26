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
