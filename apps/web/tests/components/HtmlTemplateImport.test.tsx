// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HtmlTemplateImport } from '../../src/components/HtmlTemplateImport';
import type { ProjectTemplateDetail } from '@open-design/contracts';

const importedTemplate: ProjectTemplateDetail = {
  id: 'tpl_html',
  name: 'Marketing page',
  sourceKind: 'html-import',
  files: [{ name: 'index.html', content: '<h1>Launch</h1>', kind: 'html' }],
  htmlSource: '<h1>Launch</h1>',
  derivationStatus: 'partial',
  derivationWarnings: ['No CSS variables found.'],
  designSystem: {
    manifest: {
      schemaVersion: 'od-design-system-project/v1',
      id: 'ds_tpl_html',
      name: 'Marketing page',
      category: 'Imported HTML',
      files: { design: 'DESIGN.md', tokens: 'tokens.css', components: 'components.html' },
    },
    designMd: '# Marketing page',
    tokensCss: ':root { --color-1: #3366ff; }',
    componentsHtml: '<main>Launch</main>',
    extractedColors: ['#3366ff', '#101010'],
    extractionWarnings: ['No CSS variables found.'],
  },
  createdAt: 1760000000000,
};

afterEach(() => {
  cleanup();
});

describe('HtmlTemplateImport', () => {
  it('imports pasted HTML, shows derivation details, and can create a project', async () => {
    const importTemplate = vi.fn(async () => importedTemplate);
    const createProject = vi.fn(async () => ({
      projectId: 'proj_html',
      template: {
        id: 'tpl_html',
        name: 'Marketing page',
        sourceKind: 'html-import' as const,
        derivationStatus: 'partial' as const,
        derivationWarnings: ['No CSS variables found.'],
        fileCount: 1,
        extractedColors: ['#3366ff'],
        createdAt: 1760000000000,
      },
    }));
    const onImported = vi.fn();

    render(
      <HtmlTemplateImport
        importTemplate={importTemplate}
        createProject={createProject}
        onImported={onImported}
      />,
    );

    fireEvent.change(screen.getByLabelText('Template name'), {
      target: { value: 'Marketing page' },
    });
    fireEvent.change(screen.getByLabelText('HTML source'), {
      target: { value: '<!doctype html><html><body><h1>Launch</h1></body></html>' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Import HTML' }));

    await screen.findByText('Partial');
    expect(screen.getByText('#3366ff')).toBeTruthy();
    expect(screen.getByText('No CSS variables found.')).toBeTruthy();
    expect(onImported).toHaveBeenCalledWith(importedTemplate);

    fireEvent.change(screen.getByLabelText('Project name'), {
      target: { value: 'Template project' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }));

    await screen.findByText('Created project proj_html');
    expect(createProject).toHaveBeenCalledWith('tpl_html', {
      name: 'Template project',
      designSystemId: null,
    });
  });

  it('reads an uploaded HTML file into the import request', async () => {
    const importTemplate = vi.fn(async () => importedTemplate);
    render(<HtmlTemplateImport importTemplate={importTemplate} />);

    fireEvent.change(screen.getByLabelText('Template name'), {
      target: { value: 'File import' },
    });
    fireEvent.change(screen.getByLabelText('HTML file'), {
      target: {
        files: [
          new File(['<!doctype html><html><body>From file</body></html>'], 'page.html', {
            type: 'text/html',
          }),
        ],
      },
    });
    await waitFor(() => {
      const source = screen.getByLabelText('HTML source');
      expect(source).toBeInstanceOf(HTMLTextAreaElement);
      if (!(source instanceof HTMLTextAreaElement)) throw new Error('HTML source is not a textarea');
      expect(source.value).toBe('<!doctype html><html><body>From file</body></html>');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Import HTML' }));

    await waitFor(() => {
      expect(importTemplate).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'File import',
          fileName: 'page.html',
          html: '<!doctype html><html><body>From file</body></html>',
        }),
      );
    });
  });
});
