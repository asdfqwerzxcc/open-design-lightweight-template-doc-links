import path from 'node:path';

import type { DesignSystemDetail } from '@open-design/contracts';

export function renderStaticExportIndex(detail: DesignSystemDetail, files: string[]): string {
  const links = [
    'design-system.html',
    'tokens.html',
    'components.html',
    'examples.html',
    'source-evidence.html',
    'quality-report.html',
    'data/design-system.json',
  ]
    .filter((file) => files.includes(file))
    .map((file) => `<li><a href="${escapeAttribute(file)}">${escapeHtml(titleForFile(file))}</a></li>`)
    .join('');
  const assetLink = files.includes('assets/logo.svg')
    ? '<p><a href="assets/logo.svg">Open logo asset</a></p>'
    : '';
  return `<h1>${escapeHtml(detail.title)}</h1><p>${escapeHtml(detail.summary)}</p><ul>${links}</ul>${assetLink}`;
}

export function renderStaticExportPage(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>body{font-family:Inter,system-ui,sans-serif;margin:0;color:#1f2937;background:#f8fafc}main{max-width:960px;margin:auto;padding:32px}pre{white-space:pre-wrap;background:#fff;border:1px solid #d1d5db;border-radius:8px;padding:16px;overflow:auto}iframe{width:100%;min-height:360px;border:1px solid #d1d5db;border-radius:8px;background:#fff}a{color:#2454c6}</style></head><body><main>${body}</main></body></html>\n`;
}

export function renderDesignSystemBody(detail: DesignSystemDetail): string {
  return `
    <h1>${escapeHtml(detail.title)}</h1>
    <p>${escapeHtml(detail.summary)}</p>
    <pre>${escapeHtml(detail.body)}</pre>
  `;
}

export function renderComponentsBody(
  components: string | undefined,
  componentsManifest: string | undefined,
  componentPreviews: string[] = [],
): string {
  return `
    ${components ? `<iframe sandbox srcdoc="${escapeAttribute(components)}"></iframe>` : ''}
    ${componentsManifest ? `<h2>Manifest</h2><pre>${escapeHtml(componentsManifest)}</pre>` : ''}
    ${componentPreviews.length > 0 ? `<h2>Preview Pages</h2>${renderExamplesBody(componentPreviews)}` : ''}
  `;
}

export function renderExamplesBody(previews: string[]): string {
  return previews.map((preview) => `
    <section><h2>${escapeHtml(path.basename(preview))}</h2><iframe sandbox src="${escapeAttribute(preview)}"></iframe></section>
  `).join('\n');
}

export function renderPreformattedBody(value: string): string {
  return `<pre>${escapeHtml(value)}</pre>`;
}

function titleForFile(file: string): string {
  return file.replace(/[-.]/g, ' ').replace(/\b\w/g, (match) => match.toUpperCase());
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/"/g, '&quot;');
}
