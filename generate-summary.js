#!/usr/bin/env node
//
// generate-summary.js — Build the per-PR visual diff review page on top of
// BackstopJS's report data.
//
// Layout: sticky sidebar (color-coded jump links per scenario) + main panel
// with one section per scenario. Each scenario section shows 4 columns:
// page type / PROD / TEST / DIFF with thumbnail images per viewport.
//
// After `npx backstop test`, the CLI (`kismet-vr`) runs this automatically
// and opens summary.html in your browser.

const fs = require("fs");
const path = require("path");

const REPORT_DIR = path.join(__dirname, "backstop_data", "html_report");
const CONFIG_JS = path.join(REPORT_DIR, "config.js");
const OUTPUT = path.join(REPORT_DIR, "summary.html");

if (!fs.existsSync(CONFIG_JS)) {
  console.error(
    `ERROR: ${CONFIG_JS} not found. Run \`npx backstop test\` first.`
  );
  process.exit(1);
}

// BackstopJS writes report data wrapped in `report(...)` for JSONP-style
// loading by the browser. Strip the wrapper and parse as JSON.
const raw = fs.readFileSync(CONFIG_JS, "utf-8");
const jsonText = raw.replace(/^report\s*\(/, "").replace(/\)\s*;?\s*$/, "");
const data = JSON.parse(jsonText);

const tests = data.tests || [];

// Viewport sort order: desktop first (the canonical view), then tablet, then phone.
const VIEWPORT_ORDER = { desktop: 0, tablet: 1, phone: 2 };

// Group tests by scenario label (each scenario has one row per viewport).
const byScenario = new Map();
for (const t of tests) {
  const label = t.pair.label;
  if (!byScenario.has(label)) {
    byScenario.set(label, {
      label,
      referenceUrl: t.pair.referenceUrl,
      url: t.pair.url,
      viewports: [],
    });
  }
  byScenario.get(label).viewports.push({
    viewport: t.pair.viewportLabel,
    status: t.status,
    mismatch: parseFloat(t.pair.diff?.misMatchPercentage ?? "0"),
    referenceImage: t.pair.reference,
    testImage: t.pair.test,
    diffImage: t.pair.diffImage,
    engineErrorMsg: t.pair.engineErrorMsg,
  });
}

const scenarios = Array.from(byScenario.values());

// Sort viewports inside each scenario.
for (const s of scenarios) {
  s.viewports.sort(
    (a, b) =>
      (VIEWPORT_ORDER[a.viewport] ?? 99) - (VIEWPORT_ORDER[b.viewport] ?? 99)
  );
}

// Per-scenario aggregate status:
//   error  — any engine error
//   red    — any viewport drifts ≥ 1%
//   yellow — any viewport drifts < 1% (likely noise)
//   green  — all viewports pass
function scenarioStatus(s) {
  let hasErr = false;
  let maxDrift = 0;
  let anyPass = false;
  for (const v of s.viewports) {
    if (v.engineErrorMsg) hasErr = true;
    if (v.status === "pass") anyPass = true;
    if (v.mismatch > maxDrift) maxDrift = v.mismatch;
  }
  if (hasErr) return { kind: "error", maxDrift };
  if (maxDrift >= 1) return { kind: "red", maxDrift };
  if (maxDrift > 0) return { kind: "yellow", maxDrift };
  if (anyPass) return { kind: "green", maxDrift };
  return { kind: "green", maxDrift: 0 };
}

for (const s of scenarios) {
  s._status = scenarioStatus(s);
}

// Sort scenarios for sidebar / main panel order:
//   1. errors first
//   2. red (≥1% drift), highest mismatch first
//   3. yellow (<1% drift)
//   4. green (pass)
const STATUS_RANK = { error: 0, red: 1, yellow: 2, green: 3 };
scenarios.sort((a, b) => {
  const r = STATUS_RANK[a._status.kind] - STATUS_RANK[b._status.kind];
  if (r !== 0) return r;
  return b._status.maxDrift - a._status.maxDrift;
});

// Aggregate counts (per viewport, not per scenario, for the top bar).
let totalPass = 0;
let totalFail = 0;
let totalErr = 0;
for (const s of scenarios) {
  for (const v of s.viewports) {
    if (v.engineErrorMsg) totalErr++;
    else if (v.status === "pass") totalPass++;
    else totalFail++;
  }
}

const escape = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

// Derive a friendly page-type label and a clean URL-safe anchor ID from the
// scenario label "Cascadia Getaways HOMEPAGE · cascadiagetaways.com vs preview".
function parseLabel(label) {
  // Strip the trailing " · prodhost vs preview" suffix for display.
  const stripped = label.replace(/\s*·\s*[^·]+\s+vs\s+preview\s*$/i, "");
  // Last "word" is the page-type slug or "CUSTOM: /slug"
  // Examples: "Cascadia Getaways HOMEPAGE" → "HOMEPAGE"
  //           "Cascadia Getaways CUSTOM: /property-management" → "CUSTOM: /property-management"
  const customMatch = stripped.match(/(CUSTOM:\s*\/.+?)$/);
  const pageType = customMatch
    ? customMatch[1]
    : stripped.split(/\s+/).pop();
  return {
    pageType,
    friendly: stripped,
    anchor: stripped.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
  };
}

function statusDotColor(status) {
  switch (status.kind) {
    case "error":
      return "#8e8e93";
    case "red":
      return "#ff3b30";
    case "yellow":
      return "#ff9500";
    case "green":
      return "#34c759";
  }
}

function viewportBadge(v) {
  if (v.engineErrorMsg)
    return `<span class="vp-badge err">ERROR</span>`;
  if (v.status === "pass") return `<span class="vp-badge pass">PASS</span>`;
  const tier = v.mismatch >= 10 ? "high" : v.mismatch >= 1 ? "mid" : "low";
  return `<span class="vp-badge fail ${tier}">${v.mismatch.toFixed(2)}%</span>`;
}

// All summary file references are relative to backstop_data/html_report/.
// Images live in ../bitmaps_reference, ../bitmaps_test, and ../ci_report (or
// already-relative paths inside config.js).
function imagePath(p) {
  if (!p) return null;
  // BackstopJS stores paths relative to the project root, but the report HTML
  // is served from backstop_data/html_report/ — so we need to go up two levels.
  // Paths in config.js look like "../bitmaps_reference/..." already, which works
  // from the report dir. Strip a leading "./" if present.
  return p.replace(/^\.\//, "");
}

// Sidebar entry HTML.
function renderSidebarItem(s) {
  const { pageType, anchor } = parseLabel(s.label);
  const dot = statusDotColor(s._status);
  const driftLabel =
    s._status.kind === "green"
      ? "PASS"
      : s._status.kind === "error"
      ? "ERR"
      : `${s._status.maxDrift.toFixed(1)}%`;
  return `<a class="side-item" href="#${anchor}">
    <span class="dot" style="background:${dot}"></span>
    <span class="side-label">${escape(pageType)}</span>
    <span class="side-drift">${driftLabel}</span>
  </a>`;
}

// Scenario section HTML.
function renderScenario(s) {
  const { pageType, friendly, anchor } = parseLabel(s.label);
  const dot = statusDotColor(s._status);
  const headerStatus =
    s._status.kind === "green"
      ? "PASS"
      : s._status.kind === "error"
      ? "ENGINE ERROR"
      : `${s._status.maxDrift.toFixed(2)}% max drift`;

  const viewportRows = s.viewports
    .map((v) => {
      const ref = imagePath(v.referenceImage);
      const test = imagePath(v.testImage);
      const diff = imagePath(v.diffImage);
      const errorMsg = v.engineErrorMsg
        ? `<div class="err-msg">${escape(v.engineErrorMsg)}</div>`
        : "";
      return `<tr>
        <td class="col-pt">
          <div class="vp-name">${escape(v.viewport)}</div>
          ${viewportBadge(v)}
        </td>
        <td class="col-img">
          ${ref ? `<a href="${escape(ref)}" target="_blank" rel="noopener"><img loading="lazy" src="${escape(ref)}" alt="prod ${escape(v.viewport)}"></a>` : '<div class="missing">no image</div>'}
        </td>
        <td class="col-img">
          ${test ? `<a href="${escape(test)}" target="_blank" rel="noopener"><img loading="lazy" src="${escape(test)}" alt="preview ${escape(v.viewport)}"></a>` : '<div class="missing">no image</div>'}
          ${errorMsg}
        </td>
        <td class="col-img">
          ${diff ? `<a href="${escape(diff)}" target="_blank" rel="noopener"><img loading="lazy" src="${escape(diff)}" alt="diff ${escape(v.viewport)}"></a>` : '<div class="missing">—</div>'}
        </td>
      </tr>`;
    })
    .join("\n");

  return `<section class="scenario" id="${anchor}">
    <header class="scenario-header">
      <span class="dot" style="background:${dot}"></span>
      <h2>${escape(friendly)}</h2>
      <span class="scenario-status">${headerStatus}</span>
    </header>
    <table class="scenario-table">
      <thead>
        <tr>
          <th class="col-pt-h">Page type<br><span class="hint">${escape(pageType)}</span></th>
          <th class="col-img-h">
            <div class="col-title">PROD</div>
            <a class="col-url" href="${escape(s.referenceUrl)}" target="_blank" rel="noopener">${escape(s.referenceUrl)}</a>
          </th>
          <th class="col-img-h">
            <div class="col-title">TEST</div>
            <a class="col-url" href="${escape(s.url)}" target="_blank" rel="noopener">${escape(s.url)}</a>
          </th>
          <th class="col-img-h">
            <div class="col-title">DIFF</div>
            <span class="col-url">(BackstopJS pixel overlay)</span>
          </th>
        </tr>
      </thead>
      <tbody>
        ${viewportRows}
      </tbody>
    </table>
  </section>`;
}

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Kismet WL Visual Regression — Summary</title>
  <style>
    :root {
      --bg: #f5f5f7;
      --panel: #ffffff;
      --text: #1d1d1f;
      --muted: #6e6e73;
      --border: #e5e5ea;
      --accent: #007aff;
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; font-size: 14px; line-height: 1.4; }
    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }

    .layout { display: grid; grid-template-columns: 280px 1fr; min-height: 100vh; }
    .sidebar { background: var(--panel); border-right: 1px solid var(--border); padding: 16px 12px 24px; position: sticky; top: 0; height: 100vh; overflow-y: auto; }
    .main { padding: 24px 32px; max-width: 1600px; }

    .sb-title { font-size: 11px; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; padding: 8px 8px 12px; }
    .sb-counts { display: flex; gap: 6px; padding: 0 8px 16px; border-bottom: 1px solid var(--border); margin-bottom: 12px; }
    .sb-count { flex: 1; background: var(--bg); border-radius: 6px; padding: 8px 6px; text-align: center; }
    .sb-count strong { display: block; font-size: 18px; font-weight: 600; }
    .sb-count span { font-size: 10px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.3px; }
    .sb-count.pass strong { color: #34c759; }
    .sb-count.fail strong { color: #ff9500; }
    .sb-count.err strong { color: #ff3b30; }

    .side-item { display: grid; grid-template-columns: 14px 1fr auto; align-items: center; gap: 8px; padding: 7px 10px; border-radius: 6px; color: var(--text); margin-bottom: 2px; font-size: 13px; }
    .side-item:hover { background: var(--bg); text-decoration: none; }
    .side-item .dot { width: 10px; height: 10px; border-radius: 50%; }
    .side-item .side-label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .side-item .side-drift { font-size: 11px; color: var(--muted); font-variant-numeric: tabular-nums; }

    .meta { color: var(--muted); margin: 0 0 24px; font-size: 13px; }
    code { background: #f0f0f3; padding: 1px 5px; border-radius: 4px; font-family: ui-monospace, "SF Mono", Monaco, monospace; font-size: 12px; }
    .open-default { float: right; font-size: 13px; padding: 6px 12px; border: 1px solid var(--accent); border-radius: 6px; }
    .open-default:hover { background: var(--accent); color: white; text-decoration: none; }

    .scenario { background: var(--panel); border-radius: 10px; padding: 18px 20px; margin-bottom: 18px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); scroll-margin-top: 12px; }
    .scenario-header { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; padding-bottom: 12px; border-bottom: 1px solid var(--border); }
    .scenario-header .dot { width: 12px; height: 12px; border-radius: 50%; flex-shrink: 0; }
    .scenario-header h2 { margin: 0; font-size: 18px; font-weight: 600; flex: 1; }
    .scenario-header .scenario-status { font-size: 13px; color: var(--muted); font-variant-numeric: tabular-nums; }

    .scenario-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    .scenario-table th, .scenario-table td { vertical-align: top; padding: 10px 12px; border-bottom: 1px solid var(--border); }
    .scenario-table tbody tr:last-child td { border-bottom: none; }
    .col-pt-h { width: 13%; font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.4px; text-align: left; font-weight: 600; }
    .col-pt-h .hint { display: block; color: var(--text); text-transform: none; letter-spacing: 0; font-size: 12px; font-weight: 500; margin-top: 2px; }
    .col-img-h { width: 29%; text-align: left; font-weight: 600; padding-bottom: 6px; }
    .col-img-h .col-title { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 4px; }
    .col-img-h .col-url { font-size: 12px; color: var(--accent); font-weight: 400; word-break: break-all; display: block; }
    .col-pt { width: 13%; }
    .col-pt .vp-name { font-size: 13px; font-weight: 600; margin-bottom: 4px; }
    .col-img { width: 29%; padding: 8px 12px; }
    .col-img img { width: 100%; height: auto; display: block; border-radius: 6px; border: 1px solid var(--border); cursor: zoom-in; }
    .col-img a { display: block; }
    .col-img .missing { color: var(--muted); font-size: 12px; padding: 24px; text-align: center; background: var(--bg); border-radius: 6px; }
    .col-img .err-msg { color: #ff3b30; font-size: 12px; padding: 8px; margin-top: 6px; background: #fff0f0; border-radius: 4px; }

    .vp-badge { display: inline-block; padding: 2px 7px; border-radius: 10px; font-size: 10px; font-weight: 700; letter-spacing: 0.3px; }
    .vp-badge.pass { background: #d4f4dd; color: #155724; }
    .vp-badge.fail.low { background: #fff3cd; color: #856404; }
    .vp-badge.fail.mid { background: #ffe5b4; color: #8a5400; }
    .vp-badge.fail.high { background: #ffd0d0; color: #a01010; }
    .vp-badge.err { background: #f0f0f3; color: #6e6e73; }
  </style>
</head>
<body>
  <div class="layout">
    <aside class="sidebar">
      <div class="sb-title">Kismet WL VR</div>
      <div class="sb-counts">
        <div class="sb-count pass"><strong>${totalPass}</strong><span>Pass</span></div>
        <div class="sb-count fail"><strong>${totalFail}</strong><span>Drift</span></div>
        <div class="sb-count err"><strong>${totalErr}</strong><span>Err</span></div>
      </div>
      ${scenarios.map(renderSidebarItem).join("\n")}
    </aside>
    <main class="main">
      <p class="meta">
        ${scenarios.length} scenarios across ${tests.length} viewport runs.
        Generated <code>${new Date().toISOString()}</code>.
        <a class="open-default" href="index.html">Full BackstopJS report →</a>
      </p>
      ${scenarios.map(renderScenario).join("\n")}
    </main>
  </div>
</body>
</html>
`;

fs.writeFileSync(OUTPUT, html);
console.log(`\nSummary written to ${OUTPUT}`);
console.log(`Pass: ${totalPass}, Drift: ${totalFail}, Engine errors: ${totalErr}`);
