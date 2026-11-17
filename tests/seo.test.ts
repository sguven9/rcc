import { describe, expect, it } from "vitest";
import { buildDocs } from "../site/build";
import { pages } from "../site/config";
import { docsMetadata, jsonLd, indexMetadata } from "../site/seo";
import { BRAND } from "../src/config/brand";

describe("search and sharing metadata", () => {
  it("adds a sitemap and canonical URLs only when the deployed origin is configured", () => {
    const files = buildDocs(process.cwd());
    if (!BRAND.siteUrl) {
      expect(files.has("/sitemap.xml")).toBe(false);
      expect(files.has("/robots.txt")).toBe(false);
      expect(indexMetadata()).not.toContain('rel="canonical"');
    } else {
      const xml = String(files.get("/sitemap.xml")!.data);
      expect(xml).toContain(`${BRAND.siteUrl}/`);
    }
    expect(String(files.get("/docs/404.html")!.data)).toContain(
      'content="noindex, follow"',
    );
  });
  it("gives every guide its own description and names the product from BRAND", () => {
    const descriptions = new Set<string>();
    for (const page of pages) {
      const html = docsMetadata(page, "next", "0.8.0", false);
      const description = html.match(
        /name="description" content="([^"]+)"/,
      )![1];
      expect(description.length).toBeGreaterThan(40);
      expect(descriptions.has(description)).toBe(false);
      descriptions.add(description);
      expect(html).toContain(`${BRAND.name} docs`);
      expect(html).not.toMatch(/github\.com/i);
    }
    expect(indexMetadata()).toContain(BRAND.name);
    expect(indexMetadata()).toContain(BRAND.tagline);
    expect(indexMetadata()).toContain('content="summary_large_image"');
  });
  it("cannot terminate structured-data scripts with an imported title", () => {
    const encoded = jsonLd({ name: '</script><img src=x onerror="alert(1)">' });
    expect(encoded.match(/<\/script>/g)).toHaveLength(1);
    expect(encoded).not.toContain("<img");
  });
});
