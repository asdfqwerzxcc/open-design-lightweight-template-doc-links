import { describe, expect, it } from 'vitest';

import type {
  DesignSystemDetail,
  DesignSystemStaticHtmlExportRequest,
  DesignSystemStaticHtmlExportResponse,
  PromoteProjectToDesignSystemRequest,
  PromoteProjectToDesignSystemResponse,
} from '../src/index';

describe('design system promotion and static export contracts', () => {
  const designSystem = {
    id: 'user:acme',
    title: 'Acme Design System',
    category: 'Internal',
    summary: 'Shared internal design patterns.',
    swatches: ['#111111', '#f5f5f5'],
    source: 'user',
    status: 'draft',
    isEditable: true,
    body: '# Acme Design System',
  } satisfies DesignSystemDetail;

  it('exposes project promotion request and response types through the contracts barrel', () => {
    const request = {
      title: 'Acme Design System',
      status: 'published',
    } satisfies PromoteProjectToDesignSystemRequest;

    const response = {
      designSystem,
      projectId: 'project_123',
      sourceFiles: ['DESIGN.md', 'tokens.css'],
      warnings: [],
    } satisfies PromoteProjectToDesignSystemResponse;

    expect(request.status).toBe('published');
    expect(response.projectId).toBe('project_123');
    expect(response.sourceFiles).toEqual(['DESIGN.md', 'tokens.css']);
  });

  it('exposes static HTML export request and response types through the contracts barrel', () => {
    const request = {
      outDir: '/tmp/open-design-exports',
      includeSourceEvidence: true,
    } satisfies DesignSystemStaticHtmlExportRequest;

    const response = {
      export: {
        designSystemId: designSystem.id,
        folder: '/tmp/open-design-exports/acme-static-html-2026-06-11T12-00-00-000Z',
        entryFile: '/tmp/open-design-exports/acme-static-html-2026-06-11T12-00-00-000Z/index.html',
        files: ['index.html', 'data/design-system.json'],
        warnings: [],
      },
    } satisfies DesignSystemStaticHtmlExportResponse;

    expect(request.includeSourceEvidence).toBe(true);
    expect(response.export.designSystemId).toBe(designSystem.id);
    expect(response.export.files).toContain('data/design-system.json');
  });
});
