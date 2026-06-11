import type http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer } from '../src/server.js';

describe('document box routes', () => {
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

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  async function uploadDocument(fileName: string, content: Blob, title?: string) {
    const form = new FormData();
    form.set('file', new File([content], fileName));
    if (title) form.set('title', title);
    return await fetch(`${baseUrl}/api/document-box/documents`, {
      method: 'POST',
      body: form,
    });
  }

  it('adds, lists, links, serves, and revokes a document', async () => {
    const uploadResponse = await uploadDocument('one-page.pdf', new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])], { type: 'application/pdf' }), 'One Page');
    expect(uploadResponse.status).toBe(201);
    const uploadBody = await uploadResponse.json() as {
      readonly document: { readonly id: string; readonly title: string; readonly fileName: string };
    };
    expect(uploadBody.document).toMatchObject({
      title: 'One Page',
      fileName: 'one-page.pdf',
    });

    const listResponse = await fetch(`${baseUrl}/api/document-box/documents`);
    expect(listResponse.status).toBe(200);
    const listBody = await listResponse.json() as {
      readonly documents: ReadonlyArray<{ readonly id: string; readonly title: string }>;
    };
    expect(listBody.documents.some((document) => document.id === uploadBody.document.id)).toBe(true);

    const linkResponse = await fetch(`${baseUrl}/api/document-box/documents/${uploadBody.document.id}/links`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(linkResponse.status).toBe(201);
    const linkText = await linkResponse.text();
    const linkBody = JSON.parse(linkText) as {
      readonly link: { readonly id: string; readonly tokenUrl: string };
    };
    const token = tokenFromUrl(linkBody.link.tokenUrl);
    expect(token).toBeTruthy();
    expect(linkText.split(token).length - 1).toBe(1);

    const listLinksResponse = await fetch(`${baseUrl}/api/document-box/documents/${uploadBody.document.id}/links`);
    expect(listLinksResponse.status).toBe(200);
    expect(await listLinksResponse.text()).not.toContain(token);

    const publicResponse = await fetch(`${baseUrl}${new URL(linkBody.link.tokenUrl).pathname}`);
    expect(publicResponse.status).toBe(200);
    expect(publicResponse.headers.get('content-type')).toBe('application/pdf');
    expect(publicResponse.headers.get('cache-control')).toBe('no-store');
    expect(publicResponse.headers.get('x-content-type-options')).toBe('nosniff');
    expect(publicResponse.headers.get('content-disposition')).toContain('inline; filename="one-page.pdf"');
    expect(await publicResponse.arrayBuffer()).toEqual(new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer);

    const revokeResponse = await fetch(`${baseUrl}/api/document-box/links/${linkBody.link.id}/revoke`, {
      method: 'POST',
    });
    expect(revokeResponse.status).toBe(200);

    const revokedResponse = await fetch(`${baseUrl}${new URL(linkBody.link.tokenUrl).pathname}`);
    expect(revokedResponse.status).toBe(404);
  });

  it('returns 410 for expired public links', async () => {
    const uploadResponse = await uploadDocument('expires.txt', new Blob(['expires'], { type: 'text/plain' }));
    expect(uploadResponse.status).toBe(201);
    const uploadBody = await uploadResponse.json() as { readonly document: { readonly id: string } };

    const linkResponse = await fetch(`${baseUrl}/api/document-box/documents/${uploadBody.document.id}/links`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresAt: Date.now() - 1000 }),
    });
    expect(linkResponse.status).toBe(201);
    const linkBody = await linkResponse.json() as { readonly link: { readonly tokenUrl: string } };

    const publicResponse = await fetch(`${baseUrl}${new URL(linkBody.link.tokenUrl).pathname}`);
    expect(publicResponse.status).toBe(410);
  });

  it('preserves x characters in public filenames', async () => {
    const uploadResponse = await uploadDocument('manual.txt', new Blob(['filename'], { type: 'text/plain' }));
    expect(uploadResponse.status).toBe(201);
    const uploadBody = await uploadResponse.json() as { readonly document: { readonly id: string } };

    const linkResponse = await fetch(`${baseUrl}/api/document-box/documents/${uploadBody.document.id}/links`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(linkResponse.status).toBe(201);
    const linkBody = await linkResponse.json() as { readonly link: { readonly tokenUrl: string } };

    const publicResponse = await fetch(`${baseUrl}${new URL(linkBody.link.tokenUrl).pathname}`);
    expect(publicResponse.headers.get('content-disposition')).toContain('inline; filename="manual.txt"');
  });

  it('rejects unsupported and oversized uploads', async () => {
    const unsupported = await uploadDocument('malware.exe', new Blob(['nope']));
    expect(unsupported.status).toBe(415);

    const oversized = await uploadDocument('too-large.pdf', new Blob([new Uint8Array(25 * 1024 * 1024 + 1)]));
    expect(oversized.status).toBe(413);
  }, 30_000);
});

function tokenFromUrl(tokenUrl: string): string {
  const token = tokenUrl.split('/document-box/')[1];
  if (!token) throw new Error('token URL did not contain a document-box token');
  return token;
}
