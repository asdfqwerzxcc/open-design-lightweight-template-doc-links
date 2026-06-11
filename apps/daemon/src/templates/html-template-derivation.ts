import * as cheerio from 'cheerio';
import type { ProjectTemplateDesignSystem } from '@open-design/contracts';

const COLOR_PATTERN = /#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)/g;

export interface DeriveHtmlTemplateDesignSystemInput {
  html: string;
  name: string;
}

export function deriveHtmlTemplateDesignSystem(
  input: DeriveHtmlTemplateDesignSystemInput,
): ProjectTemplateDesignSystem {
  const $ = cheerio.load(input.html);
  const title = (normalizeText($('title').first().text())
    ?? normalizeText($('h1,h2,h3').first().text())
    ?? input.name.trim())
    || 'Imported HTML Template';
  const colors = extractColors(input.html);
  const tokensCss = buildTokensCss(colors);
  const bodyHtml = $('body').html()?.trim() ?? input.html.trim();

  return {
    manifest: {
      schemaVersion: 'od-design-system-project/v1',
      id: slugify(title),
      name: title,
      category: 'User Template',
      files: {
        design: 'DESIGN.md',
        tokens: 'tokens.css',
        components: 'components.html',
      },
    },
    designMd: `# ${title}\n\nImported from user-authored HTML. Review extracted tokens before broad reuse.\n`,
    tokensCss,
    componentsHtml: `<main data-open-design-template="html-import">\n${bodyHtml}\n</main>\n`,
    extractedColors: colors,
    extractionWarnings: colors.length === 0 ? ['No CSS colors were detected; neutral fallback tokens were generated.'] : [],
  };
}

function normalizeText(value: string): string | undefined {
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function extractColors(html: string): string[] {
  const matches = html.match(COLOR_PATTERN) ?? [];
  const seen = new Set<string>();
  for (const match of matches) {
    const color = match.startsWith('#') ? match.toLowerCase() : match.replace(/\s+/g, ' ');
    seen.add(color);
    if (seen.size >= 12) break;
  }
  return [...seen];
}

function buildTokensCss(colors: string[]): string {
  const palette = colors.length > 0 ? colors : ['#111827', '#f9fafb', '#6b7280'];
  const lines = palette.map((color, index) => `  --color-${index + 1}: ${color};`);
  return `:root {\n${lines.join('\n')}\n}\n`;
}

function slugify(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return slug || 'imported-html-template';
}
