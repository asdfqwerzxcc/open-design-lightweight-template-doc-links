import type http from 'node:http';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, openDatabase } from '../src/db.js';
import {
  addDocumentBoxDocument,
  createDocumentBoxLink,
  deleteDocumentBoxDocument,
  getDocumentBoxDocument,
  listDocumentBoxLinks,
  resolveDocumentBoxLink,
} from '../src/document-box.js';
import { startServer } from '../src/server.js';

describe('document box storage security', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), 'od-document-box-security-'));
  });

  afterEach(() => {
    closeDatabase();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('hashes tokens, sanitizes traversal names, and removes files on delete', async () => {
    const db = openDatabase(tempDir);
    const documentRoot = path.join(tempDir, '.od', 'document-box');
    const document = await addDocumentBoxDocument(db, {
      documentRoot,
      id: 'doc_secure',
      fileName: '../secret.txt',
      title: 'Secret',
      mimeType: 'text/plain',
      content: Buffer.from('secret'),
      now: 100,
    });

    expect(document.fileName).toBe('secret.txt');
    expect(path.relative(documentRoot, document.storedPath)).toBe(path.join('doc_secure', 'secret.txt'));
    expect(existsSync(document.storedPath)).toBe(true);

    createDocumentBoxLink(db, {
      id: 'link_secure',
      documentId: document.id,
      token: 'raw-secret-token',
      now: 110,
    });
    const tokenRow = db.prepare('SELECT token_hash AS tokenHash FROM document_box_links WHERE id = ?').get('link_secure') as {
      readonly tokenHash: string;
    };
    expect(tokenRow.tokenHash).toBe(createHash('sha256').update('raw-secret-token').digest('hex'));
    expect(tokenRow.tokenHash).not.toBe('raw-secret-token');
    expect(JSON.stringify(listDocumentBoxLinks(db, document.id))).not.toContain('raw-secret-token');

    expect(deleteDocumentBoxDocument(db, document.id, 120)).toBe(true);
    expect(getDocumentBoxDocument(db, document.id)).toBeNull();
    expect(resolveDocumentBoxLink(db, { token: 'raw-secret-token', now: 130 }).status).toBe('not_found');
    expect(existsSync(document.storedPath)).toBe(false);
  });
});

describe('document box public route security', () => {
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
    server.closeAllConnections?.();
    return new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('sandboxes public HTML and SVG documents', async () => {
    const htmlLink = await uploadAndLink('sample.html', '<!doctype html><script>throw new Error()</script>', 'text/html');
    const htmlResponse = await fetch(`${baseUrl}${new URL(htmlLink.tokenUrl).pathname}`);
    expect(htmlResponse.status).toBe(200);
    expect(htmlResponse.headers.get('content-security-policy')).toContain('sandbox');
    expect(htmlResponse.headers.get('x-content-type-options')).toBe('nosniff');

    const svgLink = await uploadAndLink('shape.svg', '<svg><script /></svg>', 'image/svg+xml');
    const svgResponse = await fetch(`${baseUrl}${new URL(svgLink.tokenUrl).pathname}`);
    expect(svgResponse.status).toBe(200);
    expect(svgResponse.headers.get('content-security-policy')).toContain('sandbox');
    expect(svgResponse.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('returns 404 for unknown and revoked public links', async () => {
    const unknown = await fetch(`${baseUrl}/document-box/not-a-real-token`);
    expect(unknown.status).toBe(404);

    const link = await uploadAndLink('revoked.txt', 'revoked', 'text/plain');
    const revoke = await fetch(`${baseUrl}/api/document-box/links/${link.id}/revoke`, { method: 'POST' });
    expect(revoke.status).toBe(200);

    const revoked = await fetch(`${baseUrl}${new URL(link.tokenUrl).pathname}`);
    expect(revoked.status).toBe(404);
  });

  async function uploadAndLink(fileName: string, content: string, mimeType: string): Promise<{ readonly id: string; readonly tokenUrl: string }> {
    const form = new FormData();
    form.set('file', new File([content], fileName, { type: mimeType }));
    const upload = await fetch(`${baseUrl}/api/document-box/documents`, {
      method: 'POST',
      body: form,
    });
    expect(upload.status).toBe(201);
    const uploadBody = await upload.json() as { readonly document: { readonly id: string } };
    const link = await fetch(`${baseUrl}/api/document-box/documents/${uploadBody.document.id}/links`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(link.status).toBe(201);
    const linkBody = await link.json() as { readonly link: { readonly id: string; readonly tokenUrl: string } };
    return linkBody.link;
  }
});
