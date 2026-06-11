import type http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer } from '../src/server.js';

const HTML_DOCUMENT = '<!doctype html><html><head><title>Landing</title><style>:root{--brand:#3366ff}</style></head><body><main><h1>Landing</h1></main></body></html>';

describe('HTML template routes', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    const started = (await startServer({ port: 0, returnServer: true })) as {
      readonly url: string;
      readonly server: http.Server;
    };
    baseUrl = started.url;
    server = started.server;
  }, 30_000);

  afterAll(() => {
    if (!server) return undefined;
    return new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('imports an HTML template from a JSON body', async () => {
    const response = await fetch(`${baseUrl}/api/templates/import-html`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Landing Template',
        description: 'Reusable landing page',
        html: HTML_DOCUMENT,
        fileName: 'landing.html',
      }),
    });

    expect(response.status).toBe(201);
    const body = await response.json() as {
      readonly template: {
        readonly id: string;
        readonly name: string;
        readonly description?: string;
        readonly sourceKind: string;
        readonly files: ReadonlyArray<{ readonly name: string; readonly content: string; readonly kind?: string }>;
        readonly htmlSource?: string;
        readonly designSystem?: { readonly extractedColors: readonly string[] };
      };
    };
    expect(body.template.name).toBe('Landing Template');
    expect(body.template.description).toBe('Reusable landing page');
    expect(body.template.sourceKind).toBe('html-import');
    expect(body.template.files).toEqual([{ name: 'landing.html', content: HTML_DOCUMENT, kind: 'html' }]);
    expect(body.template.htmlSource).toBe(HTML_DOCUMENT);
    expect(body.template.designSystem?.extractedColors).toEqual(['#3366ff']);
  });

  it('imports an HTML template from multipart upload', async () => {
    const form = new FormData();
    form.set('name', 'Uploaded Template');
    form.set('file', new File([HTML_DOCUMENT], 'uploaded.html', { type: 'text/html' }));

    const response = await fetch(`${baseUrl}/api/templates/import-html`, {
      method: 'POST',
      body: form,
    });

    expect(response.status).toBe(201);
    const body = await response.json() as {
      readonly template: {
        readonly sourceKind: string;
        readonly files: ReadonlyArray<{ readonly name: string; readonly content: string; readonly kind?: string }>;
      };
    };
    expect(body.template.sourceKind).toBe('html-import');
    expect(body.template.files).toEqual([{ name: 'uploaded.html', content: HTML_DOCUMENT, kind: 'html' }]);
  });

  it('imports an HTML template from an existing Project file', async () => {
    const projectId = `template-source-${Date.now()}`;
    const createProject = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: projectId,
        name: 'Source Project',
        skillId: null,
        designSystemId: null,
      }),
    });
    expect(createProject.status).toBe(200);
    const writeFile = await fetch(`${baseUrl}/api/projects/${projectId}/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'source.html', content: HTML_DOCUMENT }),
    });
    expect(writeFile.status).toBe(200);

    const response = await fetch(`${baseUrl}/api/templates/import-html`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Project File Template',
        sourceProjectId: projectId,
        sourceFileName: 'source.html',
      }),
    });

    expect(response.status).toBe(201);
    const body = await response.json() as {
      readonly template: {
        readonly sourceProjectId?: string;
        readonly files: ReadonlyArray<{ readonly name: string; readonly content: string; readonly kind?: string }>;
      };
    };
    expect(body.template.sourceProjectId).toBe(projectId);
    expect(body.template.files).toEqual([{ name: 'source.html', content: HTML_DOCUMENT, kind: 'html' }]);
  });

  it('creates a Project from an imported HTML template', async () => {
    const importResponse = await fetch(`${baseUrl}/api/templates/import-html`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Create Project Template', html: HTML_DOCUMENT }),
    });
    expect(importResponse.status).toBe(201);
    const importBody = await importResponse.json() as { readonly template: { readonly id: string } };

    const createResponse = await fetch(`${baseUrl}/api/templates/${importBody.template.id}/create-project`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'From Landing Template' }),
    });

    expect(createResponse.status).toBe(201);
    const createBody = await createResponse.json() as {
      readonly project: {
        readonly id: string;
        readonly name: string;
        readonly metadata?: { readonly kind?: string; readonly templateId?: string; readonly templateLabel?: string };
      };
      readonly conversationId: string;
    };
    expect(createBody.project.name).toBe('From Landing Template');
    expect(createBody.project.metadata).toMatchObject({
      kind: 'template',
      templateId: importBody.template.id,
      templateLabel: 'Create Project Template',
    });
    expect(createBody.conversationId).toBeTruthy();

    const fileResponse = await fetch(`${baseUrl}/api/projects/${createBody.project.id}/files/index.html`);
    expect(fileResponse.status).toBe(200);
    expect(await fileResponse.text()).toBe(HTML_DOCUMENT);
  });

  it('rejects oversized HTML import payloads', async () => {
    const response = await fetch(`${baseUrl}/api/templates/import-html`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Oversized',
        html: `<!doctype html>${'x'.repeat(2 * 1024 * 1024 + 1)}`,
      }),
    });

    expect(response.status).toBe(413);
    const body = await response.json() as { readonly error?: { readonly code?: string } };
    expect(body.error?.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('returns TEMPLATE_NOT_FOUND when creating a Project from a missing template', async () => {
    const response = await fetch(`${baseUrl}/api/templates/missing-template/create-project`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Missing Template Project' }),
    });

    expect(response.status).toBe(404);
    const body = await response.json() as { readonly error?: { readonly code?: string } };
    expect(body.error?.code).toBe('TEMPLATE_NOT_FOUND');
  });
});
