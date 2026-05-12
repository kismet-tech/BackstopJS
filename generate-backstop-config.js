#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const PREVIEW_HOST = process.env.PREVIEW_HOST;
if (!PREVIEW_HOST) {
  console.error(
    "ERROR: PREVIEW_HOST env var is required.\n" +
      "Usage: PREVIEW_HOST=<vercel-preview-hostname> node generate-backstop-config.js"
  );
  process.exit(1);
}

const clientsPath = path.join(__dirname, "clients.json");
const outputPath = path.join(__dirname, "backstop.json");

const { clients } = JSON.parse(fs.readFileSync(clientsPath, "utf-8"));

const DEFAULT_PAGE_TYPE_PATHS = {
  HOMEPAGE: () => "/",
  OWNER_LANDING: () => "/owner-landing",
  ABOUT: () => "/about",
  CONTACT: () => "/contact",
  FAQ: () => "/faq",
  BLOG_INDEX: () => "/blog",
  BLOG_POST: (ex) => `/blog/${ex.blogSlug}`,
  AREA_GUIDE: (ex) => `/area-guides/${ex.areaGuideSlug}`,
  GROUP_INDEX: () => "/groups",
  PROPERTY_GROUP: (ex) => `/g/${ex.groupSlug}`,
  PROPERTY: (ex) => `/p/${ex.propertySlug}`,
  AREA_GUIDES_INDEX: () => "/area-guides",
  AREA_GUIDES_CATEGORY: () => "/area-guides/category/general",
  SEARCH_RESULTS: () => "/search-results",
  LEGAL: () => "/privacy",
};

const VIEWPORTS = [
  { label: "phone", width: 375, height: 667 },
  { label: "tablet", width: 768, height: 1024 },
  { label: "desktop", width: 1440, height: 900 },
];

const REMOVE_SELECTORS = [
  ".live-availability",
  "[data-dynamic]",
  "time[datetime]",
];

function interpolatePath(template, examples) {
  return template
    .replace(/\{blogSlug\}/g, examples.blogSlug || "")
    .replace(/\{areaGuideSlug\}/g, examples.areaGuideSlug || "")
    .replace(/\{groupSlug\}/g, examples.groupSlug || "")
    .replace(/\{propertySlug\}/g, examples.propertySlug || "");
}

function resolvePath(client, pageType) {
  const overrides = client.pageTypePathOverrides || {};
  if (overrides[pageType]) {
    return interpolatePath(overrides[pageType], client.examples);
  }
  const factory = DEFAULT_PAGE_TYPE_PATHS[pageType];
  if (!factory) {
    console.warn(`  WARN: unknown pageType "${pageType}" — skipping`);
    return null;
  }
  return factory(client.examples);
}

function prettyClientName(slug) {
  // cascadia-getaways → Cascadia Getaways
  return slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function makeScenario(client, slug, pageTypeOrCustomLabel, pagePath) {
  const referenceUrl = client.prodDomain + pagePath;
  const url = client.previewBase.replace("{PREVIEW_HOST}", PREVIEW_HOST) + pagePath;
  // Human-friendly label that surfaces in the BackstopJS report. Keep it short — the
  // standard report UI truncates long labels. Full URLs are emitted to scenarios.html.
  const prodHost = client.prodDomain.replace(/^https?:\/\//, "").replace(/^www\./, "");
  const label = `${prettyClientName(slug)} ${pageTypeOrCustomLabel} · ${prodHost} vs preview`;
  return {
    label,
    referenceUrl,
    url,
    delay: 2000,
    hideSelectors: [],
    removeSelectors: [...REMOVE_SELECTORS],
    onReadyScript: "puppet/onReady.js",
  };
}

const scenarios = [];

for (const client of clients) {
  const slug = client.slug;

  for (const pageType of client.pageTypes) {
    const pagePath = resolvePath(client, pageType);
    if (pagePath === null) continue;
    scenarios.push(makeScenario(client, slug, pageType, pagePath));
  }

  for (const customSlug of client.customPages || []) {
    const cleanSlug = customSlug.replace(/^\/+|\/+$/g, "");
    scenarios.push(
      makeScenario(client, slug, `CUSTOM: /${cleanSlug}`, `/${cleanSlug}`)
    );
  }
}

const config = {
  id: "kismet_wl_fleet",
  viewports: VIEWPORTS,
  scenarios,
  paths: {
    bitmaps_reference: "backstop_data/bitmaps_reference",
    bitmaps_test: "backstop_data/bitmaps_test",
    engine_scripts: "backstop_data/engine_scripts",
    html_report: "backstop_data/html_report",
    ci_report: "backstop_data/ci_report",
  },
  report: ["browser"],
  engine: "puppet",
  engineOptions: {
    args: ["--no-sandbox"],
  },
  asyncCaptureLimit: 5,
  asyncCompareLimit: 50,
  debug: false,
  debugWindow: false,
};

fs.writeFileSync(outputPath, JSON.stringify(config, null, 2) + "\n");

console.log(`\nGenerated ${scenarios.length} scenarios to ${outputPath}`);
console.log("First 3 scenario labels:");
scenarios.slice(0, 3).forEach((s) => console.log(`  - ${s.label}`));
