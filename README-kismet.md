# Kismet WL Fleet — Visual Regression with BackstopJS

Local prod-vs-Vercel-preview visual diff for white-label client pages before merging kismet.travel PRs.

## TL;DR — One Command

```bash
./kismet-vr 1102
```

Replace `1102` with any kismet.travel PR number. The script:
1. Pulls the Vercel preview URL from that PR's comments via `gh`
2. Regenerates `backstop.json` from `clients.json`
3. Captures reference screenshots from each client's prod site
4. Captures test screenshots from the preview, diffs against reference
5. Opens the summary report in your browser

If you have a preview URL already and want to skip the PR lookup:

```bash
./kismet-vr --url https://kismettravel-ithnml8f4-kismet.vercel.app
```

`./kismet-vr --help` for usage.

## One-Time Setup (two steps)

### Step 1 — Install dependencies + check out the kismet-fleet branch

```bash
cd backstop
npm install           # already done on this branch
git checkout kismet-fleet
```

Requires Node 18+, the `gh` CLI authed to `kismet-tech`, and a Chromium-based browser (Puppeteer ships its own).

### Step 2 — Generate a Vercel Protection Bypass token (required for the preview side to render)

Vercel preview URLs are auth-gated by default. Without bypass auth, Puppeteer captures the Vercel login wall instead of the real rendered page — every "drift" looks 100% because we're comparing Cascadia prod against a login page.

To bypass:

1. Vercel dashboard → kismet.travel project → **Settings** → **Deployment Protection**
2. Scroll to **Protection Bypass for Automation**
3. Click **Add new token** → name it (e.g. "kismet-vr") → copy the generated secret
4. Save the secret locally:

```bash
echo 'VERCEL_BYPASS_TOKEN=<paste-the-secret-here>' > .env
```

The `.env` file is gitignored in this directory. The `kismet-vr` CLI sources it automatically on every run.

To verify the token works:

```bash
source .env
node generate-backstop-config.js
# Look for: "Vercel bypass: ENABLED (preview URLs include bypass params)"
```

If you ever rotate the token in Vercel, just update `.env` — no other change needed.

## Manual Workflow (if you want to step through it)

```bash
# 1. Get the Vercel preview URL from the PR (e.g. kismettravel-abc.vercel.app)
export PREVIEW_HOST=kismettravel-abc.vercel.app

# 2. Generate the backstop config (reads clients.json → writes backstop.json)
node generate-backstop-config.js

# 3. Capture production baselines
npx backstop reference

# 4. Capture preview screenshots and compare
npx backstop test

# 5. Review the HTML report (auto-opens)
#    → backstop_data/html_report/index.html
```

If any scenarios fail, the report shows side-by-side prod vs preview with a diff overlay. Investigate failures, push fixes to the PR, then re-run from step 2 (or just re-run `./kismet-vr <PR>`).

## Adding a New Live Client

Edit `clients.json`. Add an entry to the `clients` array:

```json
{
  "slug": "my-client",
  "prodDomain": "https://www.myclient.com",
  "previewBase": "https://{PREVIEW_HOST}/wl/vrm/my-client",
  "examples": {
    "blogSlug": "some-blog-post-slug",
    "areaGuideSlug": "some-area-guide-slug",
    "groupSlug": "some-group-slug",
    "propertySlug": "some-property-slug"
  },
  "pageTypes": ["HOMEPAGE", "ABOUT", "CONTACT", "FAQ", "BLOG_INDEX", "BLOG_POST", "PROPERTY"],
  "pageTypePathOverrides": {
    "ABOUT": "/about-us"
  },
  "customPages": [
    "some-custom-page",
    "nested/custom-page"
  ]
}
```

Fields:

| Field | Required | Description |
|-------|----------|-------------|
| `slug` | yes | Collection slug (used for scenario labels) |
| `prodDomain` | yes | Full origin of the live production site |
| `previewBase` | yes | Origin + WL path prefix for preview; `{PREVIEW_HOST}` is replaced at config-gen time |
| `examples` | yes | Sample slugs for multi-instance page types (blog post, area guide, group, property) |
| `pageTypes` | yes | Array of page types to test for this client |
| `pageTypePathOverrides` | no | Override default URL paths per page type (e.g. if the client's ABOUT lives at `/about-us`) |
| `customPages` | no | Array of custom page slugs to test |

## Adding a New Page Type

1. Add the page type string to the client's `pageTypes` array in `clients.json`.
2. If the default path convention doesn't match, add a `pageTypePathOverrides` entry for that client.
3. If the page type is entirely new (not in `DEFAULT_PAGE_TYPE_PATHS` in `generate-backstop-config.js`), add a factory function there:

```js
const DEFAULT_PAGE_TYPE_PATHS = {
  // ...existing entries...
  MY_NEW_TYPE: () => "/my-new-path",
  MY_NEW_MULTI_INSTANCE: (ex) => `/prefix/${ex.someSlug}`,
};
```

If the new type uses a slug not in `examples`, add the slug field there too.

## Handling Dynamic Content

BackstopJS captures screenshots — dynamic elements (live pricing, availability, dates) cause false positives. The generator pre-configures `removeSelectors` to strip these before capture:

```js
const REMOVE_SELECTORS = [
  ".live-availability",   // live availability badges
  "[data-dynamic]",       // any element tagged data-dynamic
  "time[datetime]",       // date/time elements that vary
];
```

To add client-specific selectors, edit the scenario in `clients.json` or modify `makeScenario()` in `generate-backstop-config.js`.

For elements that should be hidden (preserved in layout but invisible), use `hideSelectors` instead of `removeSelectors`.

For pages that need JavaScript to settle before capture, adjust the `delay` (default 2000ms) or provide a custom `onReadyScript`.

## Troubleshooting

**404 on a page type the client doesn't render:**
Remove that page type from the client's `pageTypes` array in `clients.json`. Not every client has every page type — only list what actually exists on their production site.

**Cookie banners blocking the viewport:**
Add the banner selector to `removeSelectors` in `makeScenario()` or via a client-specific override.

**Slow-loading content (images, iframes):**
Increase `delay` in the scenario, or add an `onReadyScript` that waits for specific elements to appear. The default `puppet/onReady.js` script is in `capture/engine_scripts/`.

**Preview returns 404 for all pages:**
Verify `PREVIEW_HOST` is set correctly and the Vercel deployment is live. The preview URL pattern is `https://{PREVIEW_HOST}/wl/vrm/{collection-slug}/{page-path}`.

**`backstop.json` is stale:**
Always re-run `node generate-backstop-config.js` before each test run. The config is regenerated fresh each time.

## Reference Baselines

Reference screenshots are stored in `backstop_data/bitmaps_reference/`. By default, `npx backstop reference` regenerates them from production on every run.

The `.gitignore` excludes `bitmaps_test/` and `html_report/` but **does not** exclude `bitmaps_reference/`. Consider committing reference baselines after a clean run to establish a versioned baseline that the team can track over time. To opt out, add to `.gitignore`:

```
**/backstop_data/bitmaps_reference/
```
