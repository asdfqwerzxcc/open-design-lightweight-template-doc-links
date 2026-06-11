import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createDocumentBoxLink,
  createProjectFromTemplate,
  importHtmlTemplate,
  listDocumentBoxDocuments,
  revokeDocumentBoxLink,
  uploadDocumentBoxDocument,
} from '../../src/providers/template-document-box';

const templateResponse = {
  template: {
    id: 'tpl_1',
    name: 'Imported shell',
    sourceKind: 'html-import',
    files: [{ name: 'index.html', content: '<main>Hello</main>', kind: 'html' }],
    derivationStatus: 'partial',
    derivationWarnings: ['Used fallback tokens.'],
    createdAt: 1760000000000,
  },
};

const documentResponse = {
  document: {
    id: 'doc_1',
    title: 'Brief',
    fileName: 'brief.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 12,
    sha256: 'abc',
    createdAt: 1760000000000,
    updatedAt: 1760000000000,
  },
};

const linkResponse = {
  link: {
    id: 'link_1',
    documentId: 'doc_1',
    state: 'active',
    tokenUrl: 'http://127.0.0.1:3000/document-box/token',
    expiresAt: null,
    createdAt: 1760000000000,
    lastAccessedAt: null,
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

describe('template and document-box web providers', () => {
  it('POSTs HTML template imports as JSON and returns the template detail', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(templateResponse));
    vi.stubGlobal('fetch', fetchMock);

    const template = await importHtmlTemplate({
      name: 'Imported shell',
      description: 'Reusable HTML',
      html: '<!doctype html><html><body>Hello</body></html>',
      fileName: 'shell.html',
    });

    expect(template?.id).toBe('tpl_1');
    expect(fetchMock).toHaveBeenCalledWith('/api/templates/import-html', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Imported shell',
        description: 'Reusable HTML',
        html: '<!doctype html><html><body>Hello</body></html>',
        fileName: 'shell.html',
      }),
    });
  });

  it('creates a project from a template with a JSON body', async () => {
    const response = {
      projectId: 'proj_1',
      conversationId: 'conv_1',
      template: {
        id: 'tpl_1',
        name: 'Imported shell',
        sourceKind: 'html-import',
        derivationStatus: 'complete',
        derivationWarnings: [],
        fileCount: 1,
        extractedColors: ['#3366ff'],
        createdAt: 1760000000000,
      },
    };
    const fetchMock = vi.fn(async () => jsonResponse(response));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      createProjectFromTemplate('tpl_1', {
        name: 'Project from template',
        designSystemId: 'ds_1',
      }),
    ).resolves.toEqual(response);

    expect(fetchMock).toHaveBeenCalledWith('/api/templates/tpl_1/create-project', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Project from template',
        designSystemId: 'ds_1',
      }),
    });
  });

  it('lists, uploads, links, and revokes document-box records', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ documents: [documentResponse.document] }))
      .mockResolvedValueOnce(jsonResponse(documentResponse, { status: 201 }))
      .mockResolvedValueOnce(jsonResponse(linkResponse, { status: 201 }))
      .mockResolvedValueOnce(jsonResponse({ link: { ...linkResponse.link, state: 'revoked' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(listDocumentBoxDocuments()).resolves.toHaveLength(1);

    const file = new File(['hello'], 'brief.pdf', { type: 'application/pdf' });
    await expect(uploadDocumentBoxDocument({ file, title: 'Brief' })).resolves.toEqual(
      documentResponse.document,
    );

    await expect(
      createDocumentBoxLink('doc_1', { expiresAt: 1760000900000 }),
    ).resolves.toEqual(linkResponse.link);
    await expect(revokeDocumentBoxLink('link_1')).resolves.toBe(true);

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/document-box/documents');
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/document-box/documents', {
      method: 'POST',
      body: expect.any(FormData),
    });
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/document-box/documents/doc_1/links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresAt: 1760000900000 }),
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      '/api/document-box/links/link_1/revoke',
      { method: 'POST' },
    );
  });

  it('returns nullish safe values when daemon calls fail', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));

    await expect(importHtmlTemplate({ name: 'Bad', html: '<p>Bad</p>' })).resolves.toBeNull();
    await expect(createProjectFromTemplate('missing', { name: 'Missing' })).resolves.toBeNull();
    await expect(listDocumentBoxDocuments()).resolves.toEqual([]);
    await expect(uploadDocumentBoxDocument({ file: new File(['x'], 'x.txt') })).resolves.toBeNull();
    await expect(createDocumentBoxLink('missing', {})).resolves.toBeNull();
    await expect(revokeDocumentBoxLink('missing')).resolves.toBe(false);
  });
});
