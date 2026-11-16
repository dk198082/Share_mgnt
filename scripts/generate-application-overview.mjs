import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Use the Markdown renderer already installed in this workspace.
const root = path.resolve(import.meta.dirname, '..');
const packages = path.join(root, 'node_modules/.pnpm');
const rendererPackage = fs.readdirSync(packages).find(name => name.startsWith('markdown-it@'));
if (!rendererPackage) throw new Error('The installed markdown-it renderer was not found.');
const { default: MarkdownIt } = await import(pathToFileURL(path.join(packages, rendererPackage, 'node_modules/markdown-it/index.mjs')).href);
const md = new MarkdownIt({ html: true, linkify: false, typographer: true });
let content = md.render(fs.readFileSync(path.join(root, 'docs/shareholder-application-overview.md'), 'utf8'));
for (const [marker, file, caption] of [
  ['CONCEPTUAL_MODEL', 'conceptual-data-model.svg', 'Conceptual Data Model — business entities and interactions'],
  ['LOGICAL_MODEL', 'logical-data-model-summary.svg', 'Logical Data Model Summary — tables, keys, and relationships'],
]) {
  const svg = fs.readFileSync(path.join(root, 'docs/models', file));
  content = content.replace(`<!-- ${marker} -->`, `<figure><img src="data:image/svg+xml;base64,${svg.toString('base64')}" alt="${caption}"><figcaption>${caption}. Zoom the document to inspect labels.</figcaption></figure>`);
}
let index = 0;
const toc = [];
content = content.replace(/<h2>(.*?)<\/h2>/g, (_, title) => {
  const id = `section-${++index}`;
  toc.push(`<a href="#${id}">${title}</a>`);
  return `<h2 id="${id}">${title}</h2>`;
});
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="description" content="Business and technical overview of Shareholder Management: processes, features, integrations, data models, security, operations, and planned migration.">
<title>Shareholder Management — Application Overview</title>
<style>
:root{color-scheme:light;--ink:#20332b;--green:#173d2d;--muted:#5e6b64;--line:#d9e1db}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:#edf0ec;color:var(--ink);font:16px/1.65 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
main{max-width:1120px;margin:32px auto;padding:56px 64px;background:#fffefa;border:1px solid var(--line)}
header{border-bottom:2px solid var(--green);padding-bottom:14px;color:var(--green);font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase}
h1{font:500 52px/1.12 Georgia,serif;color:var(--green);letter-spacing:-.025em;margin:36px 0 12px}
h2{font:500 31px/1.25 Georgia,serif;color:var(--green);margin:44px 0 18px;border-top:1px solid var(--line);padding-top:25px;scroll-margin-top:20px}
h3{font-size:19px;color:var(--green);margin:27px 0 12px}p{margin:12px 0}li{margin:7px 0}a{color:#225a42}
table{width:100%;border-collapse:collapse;font-size:14px;margin:18px 0 26px;overflow-wrap:anywhere}th,td{text-align:left;vertical-align:top;padding:11px 13px;border:1px solid var(--line)}
th{background:#e8f0e9;font-weight:650}tr:nth-child(even) td{background:#f7f9f5}td:first-child{min-width:145px}
code{font: .87em ui-monospace,monospace;background:#edf1eb;padding:2px 4px;border-radius:3px;overflow-wrap:anywhere}
figure{margin:30px 0;padding:12px;border:1px solid var(--line);background:#fffefa}figure img{display:block;width:100%;height:auto}figcaption{font-size:12px;color:var(--muted);margin-top:10px}
nav{margin:28px 0;padding:20px 24px;background:#edf3ee;border:1px solid var(--line)}nav strong{display:block;margin-bottom:10px}nav div{columns:2;column-gap:25px}nav a{display:block;font-size:14px;margin:4px 0;break-inside:avoid;text-decoration:none}
footer{border-top:1px solid var(--line);margin-top:40px;padding-top:18px;font-size:12px;color:var(--muted)}
@media(max-width:760px){main{margin:0;padding:24px 18px;border:0}h1{font-size:38px}h2{font-size:26px}table{font-size:12px}td,th{padding:7px}td:first-child{min-width:0}nav div{columns:1}}
@media print{@page{size:A4;margin:16mm}body{background:white;font-size:10pt}main{border:0;margin:0;padding:0;max-width:none}h1{font-size:32pt}h2{font-size:20pt;break-after:avoid}h3{break-after:avoid}table{font-size:8pt}thead{display:table-header-group}tr{break-inside:avoid}figure{break-inside:avoid}nav{break-inside:avoid}a{color:inherit;text-decoration:none}footer{font-size:8pt}}
</style></head><body><main><header>Tinius Olsen · Internal business &amp; technical reference</header>
<nav aria-label="Contents"><strong>Document contents</strong><div>${toc.join('')}</div></nav>
${content}
<footer>Prepared 12 November 2026 · Source-based application reference, not a live production certification. No live shareholder records or secret values are included. Use your browser’s Print / Save as PDF command for a PDF copy.</footer>
</main></body></html>`;
const output = path.join(root, 'docs/shareholder-application-overview.html');
fs.writeFileSync(output, html);
console.log(`Saved ${path.relative(root, output)} (${Buffer.byteLength(html).toLocaleString()} bytes).`);
