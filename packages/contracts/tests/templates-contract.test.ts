import { describe, expect, it } from 'vitest';

import type { ProjectTemplate } from '../src/api/projects.js';
import {
  TEMPLATE_DERIVATION_STATUSES,
  TEMPLATE_SOURCE_KINDS,
  buildProjectTemplateSummary,
} from '../src/api/templates.js';
import type { ProjectTemplateDetail } from '../src/api/templates.js';

describe('project template contracts', () => {
  it('keeps legacy project snapshot templates readable before html-import fields are added', () => {
    // Given: the existing saved-template shape returned by /api/templates.
    const template = {
      id: 'tpl-legacy',
      name: 'Legacy Cards',
      sourceProjectId: 'project-1',
      files: [{ name: 'index.html', content: '<h1>Cards</h1>' }],
      description: 'Saved from a project',
      createdAt: 1_781_102_903,
    } satisfies ProjectTemplate;

    // When: callers read the typed legacy fields.
    const firstFile = template.files[0];

    // Then: the existing project snapshot contract remains unchanged.
    expect(template.sourceProjectId).toBe('project-1');
    expect(firstFile).toEqual({
      name: 'index.html',
      content: '<h1>Cards</h1>',
    });
  });

  it('accepts html import template detail with derived design-system metadata', () => {
    // Given: a user-authored HTML template imported outside an existing project.
    const detail = {
      id: 'tpl-html',
      name: 'Landing Template',
      sourceKind: 'html-import',
      description: 'Imported from a single HTML file',
      files: [
        {
          name: 'index.html',
          content: '<!doctype html><title>Landing</title><h1>Landing</h1>',
          kind: 'html',
        },
      ],
      htmlSource: '<!doctype html><title>Landing</title><h1>Landing</h1>',
      designSystem: {
        manifest: {
          schemaVersion: 'od-design-system-project/v1',
          id: 'landing-template',
          name: 'Landing Template',
          category: 'User Template',
          files: {
            design: 'DESIGN.md',
            tokens: 'tokens.css',
            components: 'components.html',
          },
        },
        designMd: '# Landing Template\n\nDerived from imported HTML.',
        tokensCss: ':root { --brand: #3366ff; }',
        componentsHtml: '<main><h1>Landing</h1></main>',
        extractedColors: ['#3366ff'],
        extractionWarnings: ['No font tokens found; using neutral fallback.'],
      },
      derivationStatus: 'partial',
      derivationWarnings: ['No font tokens found; using neutral fallback.'],
      createdAt: 1_781_102_903,
      updatedAt: 1_781_102_904,
    } satisfies ProjectTemplateDetail;

    // When: consumers build the reusable list summary from the detail payload.
    const summary = buildProjectTemplateSummary(detail);

    // Then: the summary exposes the reusable template signals without raw HTML.
    expect(TEMPLATE_SOURCE_KINDS).toEqual(['project-snapshot', 'html-import']);
    expect(TEMPLATE_DERIVATION_STATUSES).toEqual(['complete', 'partial', 'failed']);
    expect(summary).toMatchObject({
      id: 'tpl-html',
      name: 'Landing Template',
      sourceKind: 'html-import',
      derivationStatus: 'partial',
      fileCount: 1,
      extractedColors: ['#3366ff'],
    });
    expect('htmlSource' in summary).toBe(false);
  });
});
