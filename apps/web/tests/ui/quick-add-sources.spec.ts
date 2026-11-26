import { expect, test } from "../fixtures";

test("Quick add follows defaults and format overrides; sources provide compact rows and complete details", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const work = {
    id: "work-1",
    title: "Project Hail Mary",
    authors: ["Andy Weir"],
    description: "A lone astronaut must save the earth.",
    versions: [],
    availability: { owned: false, ebook: false, audio: false, stale: false },
  };
  const profile = {
    id: null,
    generation: 0,
    name: "Balanced",
    preferences: {
      desired_media: "both",
      preferred_medium: "audio",
      language: null,
      abridged: null,
      required_narrators: [],
      standalone: false,
      ebook_library_id: null,
      audio_library_id: null,
      search_series: true,
      prefer_series_packs: true,
      ebook_formats: ["epub", "pdf", "azw3", "mobi", "azw", "cbz", "cbr"],
      audio_formats: ["m4b", "mp3", "flac", "aac", "ogg", "opus"],
      source_order: ["mam", "prowlarr"],
      criteria: ["format", "source", "seeders"],
      preferred_narrators: [],
      blocked_formats: [],
      maximum_bytes: null,
    },
    overrides: {},
    origins: {},
    effective_revision: null,
    base_effective_revision: null,
    list_overrides: null,
    request_overrides: null,
    scope_origins: {},
  };
  const release = {
    source: "mam",
    source_id: "720129",
    title: work.title,
    raw_title: work.title,
    authors: work.authors,
    narrators: ["Ray Porter"],
    medium: "audio",
    formats: ["m4b"],
    size_bytes: 924634316 as number | null,
    seeders: 7534 as number | null,
    snatches: 25000,
    leechers: 2,
    freeleech: true,
    vip: true,
    tags: ["Science Fiction", "Unabridged"],
    series: [],
    language: "en",
    uploaded_at: "2026-09-01",
    description: "Search description",
    media_info: "General\nFormat: MPEG-4\nDuration: 16 hours",
    observed_at: new Date().toISOString(),
  };
  const search = {
    id: "search-1",
    work_id: work.id,
    request_id: "request-1",
    query: work.title,
    medium: "all",
    offset: 0,
    status: "completed",
    message: "Search complete",
    stale_identity: false,
    expires_at: new Date(Date.now() + 25 * 60_000).toISOString(),
    profile,
    sources: [
      {
        key: "mam",
        name: "MAM",
        state: "completed",
        count: 2,
        message: "2 results",
      },
      {
        key: "prowlarr",
        name: "Prowlarr",
        state: "completed",
        count: 0,
        message:
          "Indexers selected for search: 0 torrent, 1 Usenet. No torrent indexers are eligible. Enable a searchable torrent indexer with book or audiobook categories in Prowlarr and check Dewarr's source exclusions. Adding qBittorrent does not add torrent sources.",
      },
    ],
    items: [
      {
        id: "result-1",
        release: { ...release, freeleech: false, personal_freeleech: false },
        current_connection: true,
        expires_at: new Date(Date.now() + 25 * 60_000).toISOString(),
        assessment: {
          blocked: [],
          review: [],
          explanation: ["Preferred M4B format"],
        },
      },
      {
        id: "result-2",
        release: {
          ...release,
          source_id: "720130",
          medium: "ebook",
          narrators: [],
          formats: ["epub"],
          seeders: 2754,
          size_bytes: 9856614,
          vip: false,
        },
        current_connection: true,
        expires_at: new Date(Date.now() + 25 * 60_000).toISOString(),
        assessment: {
          blocked: ["Fixture blocked release"],
          review: [],
          explanation: [],
        },
      },
    ],
  };
  const posted: Record<string, unknown>[] = [];
  let receipt: unknown = null;
  let submitGate: Promise<void> | undefined;
  let finishSubmit: (() => void) | undefined;
  const releaseDownloads: string[] = [];
  const wedgeChoices: Array<string | null> = [];
  let held = false;
  let refreshes = 0;
  let savedDownload: Record<string, unknown> | null = null;
  const inspections: string[] = [];
  const inspectionWedges: Array<string | null> = [];
  let inspectFails = false;
  let role = "admin";
  const artifact = {
    id: "artifact-1",
    release,
    current_connection: true,
    created_at: new Date().toISOString(),
    descriptor: {
      name: "Project Hail Mary",
      files: [
        { index: 0, path: "Project Hail Mary/book.m4b", size_bytes: 12000 },
        { index: 1, path: "Project Hail Mary/book.mp3", size_bytes: 12000 },
      ],
      content_bytes: 24000,
      torrent_bytes: 300,
      padding_bytes: 0,
      private: true,
      infohash_v1: "a".repeat(40),
      artifact_sha256: "b".repeat(64),
    },
  };
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = {};
    if (path === "/api/auth/me")
      data = {
        user: {
          id: "reader",
          role,
          username: "reader",
          display_name: "Reader",
        },
        csrf_token: "test",
      };
    else if (path === "/api/setup/onboarding") data = { status: "completed" };
    else if (path === "/api/acquisition/preferences/personal")
      data = { effective: profile.preferences };
    else if (path === "/api/requests/quick-add") {
      posted.push(route.request().postDataJSON());
      await submitGate;
      receipt = {
        id: "quick-1",
        status: "completed",
        message: "Preferred downloads queued",
      };
      data = receipt;
    } else if (path.includes("/quick-add/latest/")) data = receipt;
    else if (path === "/api/requests/request-1")
      data = {
        id: "request-1",
        work_id: work.id,
        work_title: work.title,
        release_policy: profile,
        specification: { mode: "audio" },
        targets: [{ slot: "audio", state: "wanted" }],
      };
    else if (path === "/api/catalog/works/work-1") data = work;
    else if (path === "/api/metadata/works/work-1")
      data = {
        sources: [],
        conflicts: [],
        fields: {},
        versions: [],
        versions_total: 0,
      };
    else if (path.endsWith("/reader-match")) data = { book: null };
    else if (path === "/api/acquisition/profiles") data = [profile];
    else if (path === "/api/library/libraries") data = [];
    else if (path === "/api/sources/prowlarr/indexers") data = [];
    else if (path === "/api/catalog/works/work-1/source-searches") {
      refreshes++;
      search.id = `search-refreshed-${refreshes}`;
      search.medium = route.request().postDataJSON().medium;
      search.expires_at = new Date(Date.now() + 60 * 60_000).toISOString();
      search.items.forEach((item) => {
        item.expires_at = search.expires_at;
        item.current_connection = true;
      });
      data = search;
    } else if (path.endsWith("/source-searches/latest"))
      data = {
        ...search,
        items: search.items.map((item) => ({
          ...item,
          download: item.id === "result-1" ? savedDownload : null,
        })),
      };
    else if (path === "/api/sources/mam/releases/720129")
      data = {
        ...release,
        description:
          "Full MAM description\nA mission beyond the solar system.\n<script>untrusted()</script>",
      };
    else if (path === "/api/sources/mam/releases/720130")
      data = search.items[1].release;
    else if (path.endsWith("/download") && path.includes("/results/")) {
      const url = new URL(route.request().url());
      releaseDownloads.push(url.pathname);
      wedgeChoices.push(url.searchParams.get("use_wedge"));
      data = {
        id: "selected-1",
        status: "queued",
        message: "Preparing selected release",
      };
    } else if (path === "/api/acquisition/automatic-selections/selected-1") {
      savedDownload = {
        state: held ? "failed" : "queued",
        message: held
          ? "The release language does not match this request"
          : "Selected release download started",
        request_id: held ? null : "request-1",
        operation_id: "selected-1",
        reasons: held
          ? ["The release language does not match this request"]
          : [],
        prevent_download: !held,
      };
      data = {
        id: "selected-1",
        status: held ? "held" : "completed",
        message: held
          ? "No eligible release found within this page and inspection budget; review candidate reasons or refresh results"
          : "Selected release download started",
        download_id: held ? null : "download-1",
        decisions: held
          ? [
              {
                result_id: "result-1",
                reasons: ["The release language does not match this request"],
              },
            ]
          : [],
      };
    } else if (path.endsWith("/artifact")) {
      inspections.push(path);
      inspectionWedges.push(
        new URL(route.request().url()).searchParams.get("use_wedge"),
      );
      if (inspectFails) {
        inspectFails = false;
        return route.fulfill({
          status: 409,
          json: { detail: "Source settings changed. Refresh results." },
        });
      }
      data = artifact;
    } else if (path === "/api/source-artifacts/artifact-1") data = artifact;
    else if (path === "/api/acquisition/selections/options")
      data = { downloaders: [], destinations: [] };
    else if (path === "/api/acquisition/selections")
      data = { items: [], total: 0 };
    else if (path.endsWith("/torrent"))
      return route.fulfill({
        contentType: "application/x-bittorrent",
        headers: {
          "Content-Disposition": 'attachment; filename="release.torrent"',
        },
        body: "d4:infod4:name7:fixtureee",
      });
    else if (path === "/api/catalog/works") data = { items: [], total: 0 };
    else if (path.includes("/group"))
      data = { items: [], groups: [], members: [] };
    else if (path.endsWith("/versions")) data = [];
    else if (path.endsWith("/reader-details"))
      data = { authors: [], reviews: [] };
    else if (path === "/api/requests") data = { items: [], total: 0 };
    await route.fulfill({ json: data });
  });
  await page.goto("/books/work-1");
  submitGate = new Promise<void>((resolve) => {
    finishSubmit = resolve;
  });
  await page.getByRole("button", { name: "Add ebook", exact: true }).click();
  const startingStatus = page.getByRole("region", {
    name: "Quick add progress",
  });
  await expect(startingStatus).toContainText("Starting ebook request…");
  await expect(startingStatus).toBeVisible();
  finishSubmit!();
  submitGate = undefined;
  await expect(page.getByText("Preferred downloads queued")).toBeVisible();
  expect(posted[0].specification).toEqual({ mode: "ebook" });
  await expect(
    page.getByRole("group", { name: "Add to library" }).getByRole("button"),
  ).toHaveText(["Add ebook", "Add audiobook", "Add both"]);
  submitGate = new Promise<void>((resolve) => {
    finishSubmit = resolve;
  });
  await page
    .getByRole("button", { name: "Add audiobook", exact: true })
    .click();
  await expect.poll(() => posted.length).toBe(2);
  expect(posted[1].specification).toEqual({ mode: "audio" });
  await expect(startingStatus).toContainText("Starting audiobook request…");
  await expect(startingStatus).not.toContainText("Preferred downloads queued");
  finishSubmit!();
  submitGate = undefined;
  await expect(startingStatus).toContainText("Preferred downloads queued");
  await page.getByRole("button", { name: "Add both", exact: true }).click();
  await expect.poll(() => posted.length).toBe(3);
  expect(posted[2].specification).toEqual({ mode: "both" });
  receipt = {
    id: "quick-1",
    status: "running",
    message: "Searching MAM",
    source_checks: [],
  };
  await page.reload();
  const quickStatus = page.getByRole("region", { name: "Quick add progress" });
  await expect(quickStatus).toContainText("Finding your download");
  await expect(quickStatus).toContainText(
    "Finding the best match using your saved preferences.",
  );
  for (const name of ["Add ebook", "Add audiobook", "Add both"])
    await expect(
      page.getByRole("button", { name, exact: true }),
    ).toBeDisabled();
  receipt = {
    id: "quick-1",
    status: "held",
    request_id: "request-1",
    message:
      "Audiobook: Request added. No automatic release was found. MAM: No eligible release found within this page and inspection budget",
    source_checks: [
      {
        slot: "audio",
        source: "MAM",
        status: "held",
        candidates: 7,
        inspected: 5,
        message:
          "No ready torrent download route. Check your torrent client and import destination.",
        reasons: ["No ready torrent download route"],
      },
      {
        slot: "audio",
        source: "Prowlarr indexers",
        status: "held",
        candidates: 8,
        inspected: 0,
        message: "The source must corroborate the catalog title and author",
        reasons: ["The source must corroborate the catalog title and author"],
      },
    ],
  };
  await expect(quickStatus).toContainText("Request needs attention");
  await expect(quickStatus).not.toContainText("inspection budget");
  await expect(quickStatus).not.toContainText("Source checks");
  await expect(quickStatus).not.toContainText("inspected");
  await expect(quickStatus).toContainText(
    "Check your download client and library folder settings",
  );
  await expect(
    quickStatus.getByRole("link", { name: "Check download settings" }),
  ).toHaveAttribute("href", "/settings#downloaders");
  await expect(
    quickStatus.getByRole("link", { name: "Review sources" }),
  ).toHaveAttribute(
    "href",
    "/books/work-1?tab=sources&request=request-1&slot=audio",
  );
  for (const width of [1236, 390]) {
    await page.setViewportSize({ width, height: 930 });
    const box = (await quickStatus.boundingBox())!;
    expect(box.width).toBeGreaterThan(220);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    await page.screenshot({
      path: testInfo.outputPath(`quick-add-held-${width}.png`),
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  const heldReceipt = receipt;
  submitGate = new Promise<void>((resolve) => {
    finishSubmit = resolve;
  });
  await page
    .getByRole("button", { name: "Add audiobook", exact: true })
    .click();
  await expect(quickStatus).toContainText("Starting audiobook request…");
  await expect(quickStatus).not.toContainText("Request needs attention");
  await expect(
    quickStatus.getByRole("link", { name: "Review sources" }),
  ).toHaveCount(0);
  finishSubmit!();
  submitGate = undefined;
  await expect(quickStatus).toContainText("Preferred downloads queued");
  receipt = heldReceipt;
  await page.reload();
  await quickStatus.getByRole("link", { name: "Review sources" }).click();
  await expect(
    page.getByRole("heading", { name: "Prepare the best release" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Prepare best eligible release" }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Candidate decisions", { exact: false }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Choose a verified torrent downloader", { exact: false }),
  ).toHaveCount(0);
  await expect(page).toHaveURL(/tab=sources/);
  await expect(
    page.getByText(/Adding qBittorrent does not add torrent sources/),
  ).toHaveCount(0);
  // The best match leads with a single download button; the rest wait behind "Show all".
  const best = page.getByRole("region", { name: "Best match" });
  await expect(best).toBeVisible();
  await expect(
    best.getByRole("button", { name: /^Download this one / }),
  ).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(0);
  await best.getByRole("button", { name: /^Show all \d+ results$/ }).click();
  const table = page.getByRole("table");
  await expect(table.getByRole("row")).toHaveCount(2);
  for (const name of [
    "Title",
    "Author(s)",
    "Narrators",
    "Size",
    "Format",
    "Tags",
  ])
    await expect(
      table.getByRole("columnheader", { name, exact: true }),
    ).toBeVisible();
  await expect(table).toContainText("881.8 MiB");
  await expect(table).toContainText("Freeleech");
  await expect(table).toContainText("VIP");
  const sourceDownload = table.getByRole("button", {
    name: "Download Project Hail Mary",
    exact: true,
  });
  const wedge = table.getByRole("checkbox", { name: "Use a Freeleech wedge" });
  await expect(wedge).toHaveCount(1);
  await expect(wedge).toBeEnabled();
  await wedge.check();
  await sourceDownload.first().click();
  await expect(
    table.locator(".source-download-status").first(),
  ).toHaveAttribute("title", "Selected release download started");
  expect(releaseDownloads).toEqual([
    "/api/source-searches/search-refreshed-1/results/result-1/download",
  ]);
  expect(wedgeChoices).toEqual(["true"]);
  await expect(page.getByLabel("Result source")).toHaveCount(0);
  await expect(page.getByLabel("Reported format")).toBeVisible();
  await expect(
    page.getByRole("option", { name: "Unknown format", exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("sources-desktop.png"),
    fullPage: true,
  });
  const details = page
    .getByRole("button", { name: "Details for Project Hail Mary" })
    .first();
  await details.click();
  const dialog = page.getByRole("dialog", { name: "Release details" });
  await expect(dialog).toContainText("Full MAM description");
  await expect(dialog.locator(".release-prose p")).toHaveCount(3);
  await expect(
    page.getByRole("heading", { name: "Download sources", exact: true }),
  ).toHaveCount(0);
  await dialog.getByRole("tab", { name: "Media info", exact: true }).click();
  await expect(dialog).toContainText("16 hours");
  await expect(dialog.locator(".release-tab-panel dl")).toContainText("MPEG-4");
  await dialog.screenshot({
    path: testInfo.outputPath("release-media-desktop.png"),
  });
  await page.keyboard.press("ArrowRight");
  await expect(
    dialog.getByRole("tab", { name: "Details", exact: true }),
  ).toBeFocused();
  await dialog.getByRole("tab", { name: "Description", exact: true }).click();
  await expect(dialog).toContainText("Science Fiction");
  await page.screenshot({
    path: testInfo.outputPath("release-details-desktop.png"),
    fullPage: true,
  });
  await expect(
    dialog.getByRole("button", { name: "Inspect this release" }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "Save torrent" }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "Download Project Hail Mary" }),
  ).toBeDisabled();
  expect(releaseDownloads).toHaveLength(1);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(details).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: testInfo.outputPath("sources-mobile.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await table.locator(".release-title-button").first().click();
  await expect(dialog).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("release-details-mobile.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  held = true;
  savedDownload = null;
  search.items[0].release.freeleech = true;
  await page.reload();
  await table.locator(".release-title-button").first().click();
  await dialog
    .getByRole("button", { name: "Download Project Hail Mary" })
    .click();
  await expect(dialog).toContainText("Download not started");
  await expect(
    dialog.getByRole("status").filter({
      hasText: "The release language does not match this request",
    }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("link", { name: /Download not started/ }),
  ).toHaveCount(0);
  expect(releaseDownloads).toEqual([
    "/api/source-searches/search-refreshed-1/results/result-1/download",
    "/api/source-searches/search-refreshed-1/results/result-1/download",
  ]);
  expect(wedgeChoices).toEqual(["true", null]);
  await page.keyboard.press("Escape");
  const feedback = table.locator(".source-download-status").first();
  await expect(feedback).toContainText("Download not started");
  await expect(feedback).toHaveAttribute("data-tone", "error");
  await expect(feedback).toHaveAttribute("role", "status");
  for (const width of [1236, 390]) {
    await page.setViewportSize({ width, height: 930 });
    expect((await feedback.boundingBox())!.height).toBeLessThanOrEqual(32);
    await table.screenshot({
      path: testInfo.outputPath(`held-download-${width}.png`),
    });
  }
  await expect(feedback).toHaveAttribute(
    "title",
    /The release language does not match this request/,
  );
  savedDownload = {
    state: "failed",
    message: "This release needs a qBittorrent connection",
    request_id: "request-1",
    operation_id: "selected-1",
    reasons: ["This release needs a qBittorrent connection"],
    prevent_download: false,
  };
  await page.clock.install();
  await page.clock.fastForward(31_000);
  await page.evaluate(() => {
    window.dispatchEvent(new Event("offline"));
    window.dispatchEvent(new Event("online"));
  });
  await expect(feedback).toHaveAttribute("title", /qBittorrent connection/);
  // A withdrawal clears the saved receipt while the source table stays mounted.
  savedDownload = null;
  await page.clock.fastForward(31_000);
  await page.evaluate(() => {
    window.dispatchEvent(new Event("offline"));
    window.dispatchEvent(new Event("online"));
  });
  await expect(table.locator(".source-download-status")).toHaveCount(0);
  await expect(sourceDownload.first()).toBeEnabled();
  const downloadCount = releaseDownloads.length;
  search.items[0].release.freeleech = false;
  savedDownload = {
    state: "needs-review",
    message: "Alternative audio encodings need recording review",
    request_id: "another-request",
    operation_id: "selected-1",
    reasons: ["Alternative audio encodings need recording review"],
    prevent_download: false,
  };
  await page.reload();
  await table.locator(".release-title-button").first().click();
  const reviewRelease = dialog.getByRole("button", {
    name: "Review release Project Hail Mary",
    exact: true,
  });
  inspectFails = true;
  await dialog.getByLabel("Use a Freeleech wedge").check();
  await reviewRelease.click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Source settings changed",
  );
  await reviewRelease.click();
  await expect(page).toHaveURL(/sources\/artifacts\/artifact-1/);
  const reviewedUrl = new URL(page.url());
  expect(reviewedUrl.searchParams.get("request")).toBe("request-1");
  expect(reviewedUrl.searchParams.get("work")).toBe(work.id);
  expect(reviewedUrl.searchParams.get("search")).toBe("search-refreshed-1");
  expect(reviewedUrl.searchParams.get("slot")).toBe("audio");
  await expect(
    page.getByRole("heading", { name: "Torrent manifest" }),
  ).toBeVisible();
  await expect(page.getByRole("list", { name: "Torrent files" })).toContainText(
    "book.m4b",
  );
  await expect(page.getByLabel("Wanted book")).toHaveValue("request-1:audio");
  await expect(
    page.getByRole("button", { name: "Save release selection" }),
  ).toBeDisabled();
  expect(inspections).toHaveLength(2);
  expect(inspectionWedges).toEqual(["true", "true"]);
  expect(releaseDownloads).toHaveLength(downloadCount);
  await page.getByRole("link", { name: "Return to book sources" }).click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  role = "member";
  await page.reload();
  await expect(
    table.getByRole("button", {
      name: "Review release Project Hail Mary",
      exact: true,
    }),
  ).toHaveCount(0);
  role = "admin";
  for (const [state, label] of [
    ["queued", "Download queued"],
    ["downloading", "Downloading"],
    ["downloaded", "Downloaded"],
    ["imported", "In library"],
  ]) {
    savedDownload = {
      state,
      message: "Saved release status",
      request_id: "request-1",
      operation_id: "selected-1",
      attempt_id: "download-1",
      progress: 0.42,
      reasons: [],
      prevent_download: true,
    };
    await page.reload();
    await expect(feedback).toContainText(label);
    await expect(sourceDownload).toHaveCount(0);
    await expect(table.locator(".source-download-status")).toHaveCount(1);
    await expect(feedback.getByRole("progressbar")).toHaveCount(0);
    if (state === "downloading")
      await expect(feedback.locator(".source-download-spinner")).toHaveCount(1);
    if (state === "imported") {
      await expect(feedback).toHaveAttribute("data-tone", "success");
      await expect(feedback).toHaveAttribute(
        "href",
        "/requests#request-request-1",
      );
      await page.setViewportSize({ width: 1236, height: 930 });
      await table.screenshot({
        path: testInfo.outputPath("imported-release.png"),
      });
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  expect(releaseDownloads).toHaveLength(downloadCount);
  savedDownload = null;
});
