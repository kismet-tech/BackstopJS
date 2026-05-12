#!/usr/bin/env node
//
// generate-summary.js — Build a clickable URL summary on top of the BackstopJS
// HTML report. After `npx backstop test`, run this to generate
// `backstop_data/html_report/summary.html` — a friendlier landing page that:
//   - Lists every scenario with the prod URL and preview URL as clickable links
//   - Shows pass/fail status + mismatch %
//   - Links to the full BackstopJS diff report for any scenario
//
// The CLI (`kismet-vr`) runs this automatically after `npx backstop test` and
// opens summary.html in your browser.

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

// BackstopJS writes the report data as `report(...)` — eval-ish wrapping. Strip
// it and parse as JSON. (jq fails on the wrapper.)
const raw = fs.readFileSync(CONFIG_JS, "utf-8");
const jsonText = raw.replace(/^report\s*\(/, "").replace(/\)\s*;?\s*$/, "");
const data = JSON.parse(jsonText);

const tests = data.tests || [];

// Group tests by scenario label (a scenario has one row per viewport).
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

// Aggregate stats
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

function statusBadge(viewport) {
  const m = viewport.mismatch;
  if (viewport.engineErrorMsg)
    return `<span class="badge err">ERROR</span> <span class="vp">${viewport.viewport}</span>`;
  if (viewport.status === "pass")
    return `<span class="badge pass">PASS</span> <span class="vp">${viewport.viewport}</span>`;
  const tier = m >= 10 ? "high" : m >= 1 ? "mid" : "low";
  return `<span class="badge fail ${tier}">${m.toFixed(2)}%</span> <span class="vp">${viewport.viewport}</span>`;
}

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Kismet WL Visual Regression — Summary</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; max-width: 1400px; margin: 0 auto; padding: 24px; background: #f5f5f7; color: #1d1d1f; }
    h1 { font-size: 24px; margin: 0 0 8px; }
    .meta { color: #6e6e73; font-size: 14px; margin-bottom: 24px; }
    .summary-bar { background: white; border-radius: 8px; padding: 16px 20px; margin-bottom: 16px; display: flex; gap: 32px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
    .summary-bar div strong { font-size: 22px; display: block; }
    .summary-bar div span { font-size: 12px; color: #6e6e73; text-transform: uppercase; }
    .pass-count strong { color: #34c759; }
    .fail-count strong { color: #ff9500; }
    .err-count strong { color: #ff3b30; }
    .open-default { float: right; color: #007aff; text-decoration: none; font-size: 14px; padding: 8px 16px; border: 1px solid #007aff; border-radius: 6px; }
    .open-default:hover { background: #007aff; color: white; }
    table { width: 100%; border-collapse: collapse; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
    th { background: #fafafa; text-align: left; padding: 10px 14px; font-size: 12px; text-transform: uppercase; color: #6e6e73; border-bottom: 1px solid #e5e5ea; }
    td { padding: 12px 14px; border-bottom: 1px solid #f0f0f3; vertical-align: top; font-size: 14px; }
    tr:last-child td { border-bottom: none; }
    .scenario-label { font-weight: 600; color: #1d1d1f; max-width: 380px; }
    .url-cell { font-size: 13px; word-break: break-all; }
    .url-cell a { color: #007aff; text-decoration: none; }
    .url-cell a:hover { text-decoration: underline; }
    .url-cell .label { display: block; color: #6e6e73; font-size: 11px; text-transform: uppercase; margin-bottom: 2px; }
    .viewports { display: flex; gap: 6px; flex-wrap: wrap; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600; }
    .badge.pass { background: #d4f4dd; color: #155724; }
    .badge.fail.low { background: #fff3cd; color: #856404; }
    .badge.fail.mid { background: #ffe5b4; color: #8a5400; }
    .badge.fail.high { background: #ffd0d0; color: #a01010; }
    .badge.err { background: #f0f0f3; color: #6e6e73; }
    .vp { font-size: 11px; color: #6e6e73; margin-left: 2px; }
    .open-link { color: #007aff; text-decoration: none; font-size: 12px; }
    .open-link:hover { text-decoration: underline; }
    code { background: #f0f0f3; padding: 1px 6px; border-radius: 4px; font-family: ui-monospace, "SF Mono", Monaco, monospace; font-size: 12px; }
  </style>
</head>
<body>
  <h1>Kismet WL Visual Regression — Summary</h1>
  <p class="meta">
    ${scenarios.length} scenarios across ${tests.length} viewport runs. Generated <code>${new Date().toISOString()}</code>.
    <a class="open-default" href="index.html">Open full BackstopJS report →</a>
  </p>

  <div class="summary-bar">
    <div class="pass-count"><strong>${totalPass}</strong><span>Pass</span></div>
    <div class="fail-count"><strong>${totalFail}</strong><span>Drift</span></div>
    <div class="err-count"><strong>${totalErr}</strong><span>Engine errors</span></div>
  </div>

  <table>
    <thead>
      <tr>
        <th style="width: 28%">Scenario</th>
        <th style="width: 30%">${escape(scenarios[0]?.referenceUrl?.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] || "Prod URL")}<br><span style="font-weight:400;text-transform:none;color:#6e6e73">(reference — prod)</span></th>
        <th style="width: 30%">Vercel preview<br><span style="font-weight:400;text-transform:none;color:#6e6e73">(test — branch)</span></th>
        <th style="width: 12%">Drift per viewport</th>
      </tr>
    </thead>
    <tbody>
${scenarios
  .map(
    (s) => `      <tr>
        <td class="scenario-label">${escape(s.label)}</td>
        <td class="url-cell"><a href="${escape(s.referenceUrl)}" target="_blank" rel="noopener">${escape(s.referenceUrl)}</a></td>
        <td class="url-cell"><a href="${escape(s.url)}" target="_blank" rel="noopener">${escape(s.url)}</a></td>
        <td class="viewports">${s.viewports.map(statusBadge).join(" ")}</td>
      </tr>`
  )
  .join("\n")}
    </tbody>
  </table>
</body>
</html>
`;

fs.writeFileSync(OUTPUT, html);
console.log(`\nSummary written to ${OUTPUT}`);
console.log(`Pass: ${totalPass}, Drift: ${totalFail}, Engine errors: ${totalErr}`);
