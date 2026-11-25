import { expect, test } from "../fixtures";

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildStoredZip(files: Array<{ name: string; data: string }>): Buffer {
  const enc = new TextEncoder();
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = enc.encode(file.name);
    const dataBytes = enc.encode(file.data);
    const crc = crc32(dataBytes);

    const local = Buffer.alloc(30 + nameBytes.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(dataBytes.length, 18);
    local.writeUInt32LE(dataBytes.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    Buffer.from(nameBytes).copy(local, 30);

    const central = Buffer.alloc(46 + nameBytes.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(dataBytes.length, 20);
    central.writeUInt32LE(dataBytes.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    Buffer.from(nameBytes).copy(central, 46);

    localParts.push(local, Buffer.from(dataBytes));
    centralParts.push(central);
    offset += local.length + dataBytes.length;
  }

  const centralBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralBuf, eocd]);
}

function buildSampleEpub(): Buffer {
  return buildStoredZip([
    { name: "mimetype", data: "application/epub+zip" },
    {
      name: "META-INF/container.xml",
      data: `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
    },
    {
      name: "OEBPS/content.opf",
      data: `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:uuid:piranesi-test</dc:identifier>
    <dc:title>Piranesi</dc:title>
    <dc:creator>Susanna Clarke</dc:creator>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="ch2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="ch1"/>
    <itemref idref="ch2"/>
  </spine>
</package>`,
    },
    {
      name: "OEBPS/nav.xhtml",
      data: `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <head><title>Contents</title></head>
  <body>
    <nav epub:type="toc">
      <ol>
        <li><a href="ch1.xhtml">Chapter 1: The House</a></li>
        <li><a href="ch2.xhtml">Chapter 2: The Tides</a></li>
      </ol>
    </nav>
  </body>
</html>`,
    },
    {
      name: "OEBPS/ch1.xhtml",
      data: `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>Chapter 1</title></head>
  <body>
    <h1>Chapter 1: The House</h1>
    <p>The Beauty of the House is immeasurable; its Kindness infinite.</p>
  </body>
</html>`,
    },
    {
      name: "OEBPS/ch2.xhtml",
      data: `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>Chapter 2</title></head>
  <body>
    <h1>Chapter 2: The Tides</h1>
    <p>The Tides ascend the staircases with clockwork precision.</p>
  </body>
</html>`,
    },
  ]);
}

test("Built-in ebook reader renders EPUB, navigates chapters, applies themes and saves progress", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  const epubBuffer = buildSampleEpub();
  const savedProgress: Array<{
    cfi: string | null;
    fraction: number;
    chapter: string | null;
  }> = [];

  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const method = route.request().method();

    if (path === "/api/auth/me") {
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
    }
    if (path === "/api/setup/onboarding") {
      return route.fulfill({ json: { status: "completed" } });
    }
    if (path === "/api/acquisition/preferences/personal") {
      return route.fulfill({
        json: {
          effective: { desired_media: "both", preferred_medium: "ebook" },
        },
      });
    }
    if (path === "/api/reader/assets/asset-1" && method === "GET") {
      return route.fulfill({
        json: {
          asset_id: "asset-1",
          work_id: "work-1",
          title: "Piranesi",
          authors: ["Susanna Clarke"],
          cover_url: null,
          format: "epub",
          filename: "Piranesi.epub",
          file_url: "/api/reader/assets/asset-1/file",
          progress: null,
        },
      });
    }
    if (path === "/api/reader/assets/asset-1/file" && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/epub+zip",
        body: epubBuffer,
      });
    }
    if (path === "/api/reader/assets/asset-1/progress" && method === "PUT") {
      const body = route.request().postDataJSON();
      savedProgress.push(body);
      return route.fulfill({
        json: {
          ...body,
          updated_at: new Date().toISOString(),
        },
      });
    }
    if (path === "/api/reader/works/work-1/ebook") {
      return route.fulfill({
        json: {
          asset_id: "asset-1",
          work_id: "work-1",
          title: "Piranesi",
          authors: ["Susanna Clarke"],
          cover_url: null,
          format: "epub",
          filename: "Piranesi.epub",
          file_url: "/api/reader/assets/asset-1/file",
          progress: {
            cfi: "epubcfi(/6/4!/4/2/1:0)",
            fraction: 0.42,
            chapter: "Chapter 2: The Tides",
            updated_at: new Date().toISOString(),
          },
        },
      });
    }
    if (path === "/api/reader/continue") {
      return route.fulfill({
        json: [
          {
            asset_id: "asset-1",
            work_id: "work-1",
            title: "Piranesi",
            authors: ["Susanna Clarke"],
            cover_url: null,
            format: "epub",
            fraction: 0.42,
            chapter: "Chapter 2: The Tides",
            updated_at: new Date().toISOString(),
          },
        ],
      });
    }
    if (path === "/api/catalog/works/work-1") {
      return route.fulfill({
        json: {
          id: "work-1",
          title: "Piranesi",
          authors: ["Susanna Clarke"],
          description: "A labyrinth of endless halls.",
          versions: [],
          availability: {
            owned: true,
            ebook: true,
            audio: false,
            stale: false,
          },
        },
      });
    }
    if (path === "/api/library/books") {
      return route.fulfill({
        json: { items: [], total: 0, offset: 0, limit: 40 },
      });
    }
    if (path === "/api/library/assets") {
      return route.fulfill({
        json: { items: [], total: 0, offset: 0, limit: 40 },
      });
    }
    if (path === "/api/libraries" || path === "/api/library/libraries") {
      return route.fulfill({ json: [] });
    }
    if (path.includes("/group")) {
      return route.fulfill({ json: { items: [], groups: [], members: [] } });
    }
    if (path.endsWith("/versions") || path.endsWith("/part-sets")) {
      return route.fulfill({ json: [] });
    }
    if (path.endsWith("/reader-details")) {
      return route.fulfill({ json: { authors: [], reviews: [] } });
    }
    if (path === "/api/metadata/works/work-1") {
      return route.fulfill({
        json: {
          sources: [],
          fields: {},
          versions_total: 0,
          versions: [],
          cover_choices: [],
          enrichment: null,
        },
      });
    }
    if (path === "/api/following") {
      return route.fulfill({ json: [] });
    }
    if (path.endsWith("/reader-match")) {
      return route.fulfill({ json: { sources: [] } });
    }
    if (path.includes("/watches/")) {
      return route.fulfill({ json: null });
    }
    if (
      path === "/api/requests" ||
      path === "/api/acquisition/selections" ||
      path === "/api/catalog/works"
    ) {
      return route.fulfill({ json: { items: [], total: 0 } });
    }
    if (path.includes("/quick-add/latest/")) {
      return route.fulfill({ json: null });
    }
    if (path === "/api/library/review/count") {
      return route.fulfill({ json: { total: 0 } });
    }
    return route.fulfill({ json: {} });
  });

  await page.goto("/read/asset-1");

  // Header shows book title and current chapter from the EPUB
  const reader = page.getByRole("application", { name: "Ebook reader" });
  await expect(reader.getByText("Piranesi", { exact: true })).toBeVisible();

  // Wait for foliate-view to mount and finish opening the EPUB
  await expect(page.locator("foliate-view")).toBeAttached();
  await expect(page.locator(".ebook-reader-loading")).toHaveCount(0, {
    timeout: 15_000,
  });
  await expect(reader.getByText("Chapter 1: The House")).toBeVisible();

  // Open Table of Contents drawer and jump to Chapter 2
  await page.getByRole("button", { name: "Table of contents" }).click();
  await expect(
    page.getByRole("button", { name: "Chapter 1: The House" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Chapter 2: The Tides" }).click();
  await expect(reader.getByText("Chapter 2: The Tides")).toBeVisible();

  // Open Appearance settings and switch to Sepia theme
  await page.getByRole("button", { name: "Appearance settings" }).click();
  await page.getByRole("button", { name: "Sepia" }).click();
  await expect(page.locator(".ebook-reader")).toHaveAttribute(
    "data-theme",
    "sepia",
  );

  // Wait for debounced reading progress save
  await expect
    .poll(() => savedProgress.length, { timeout: 6_000 })
    .toBeGreaterThan(0);

  // Book detail page shows Continue reading button with saved percentage
  await page.goto("/books/work-1");
  await expect(
    page.getByRole("link", { name: /Continue reading · 42%/ }),
  ).toHaveAttribute("href", "/read/asset-1");

  // My Library shows Continue reading shelf
  await page.goto("/library");
  const shelf = page.getByRole("region", { name: "Continue reading" });
  await expect(shelf).toBeVisible();
  await expect(shelf.getByRole("link", { name: /Piranesi/ })).toHaveAttribute(
    "href",
    "/read/asset-1",
  );

  expect(errors).toEqual([]);
});
