import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { closeDatabase, openDatabase } from '../src/db.js';
import {
  addDocumentBoxDocument,
  createDocumentBoxLink,
  listDocumentBoxDocuments,
  resolveDocumentBoxLink,
  revokeDocumentBoxLink,
} from '../src/document-box.js';

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(path.join(os.tmpdir(), 'od-document-box-'));
});

afterEach(() => {
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('document box storage', () => {
  it('adds documents under the document box root with safe metadata', async () => {
    const db = openDatabase(tempDir);
    const documentRoot = path.join(tempDir, '.od', 'document-box');
    const content = Buffer.from('Quarterly memo', 'utf8');

    const document = await addDocumentBoxDocument(db, {
      documentRoot,
      id: 'doc_1',
      fileName: '../memo.md',
      title: 'Memo',
      mimeType: 'text/markdown',
      content,
      now: 100,
    });

    expect(document).toMatchObject({
      id: 'doc_1',
      title: 'Memo',
      fileName: 'memo.md',
      mimeType: 'text/markdown',
      sizeBytes: content.length,
      createdAt: 100,
      updatedAt: 100,
    });
    expect(document.storedPath.startsWith(documentRoot)).toBe(true);
    expect(readFileSync(document.storedPath, 'utf8')).toBe('Quarterly memo');
    expect(listDocumentBoxDocuments(db).map((item) => item.id)).toEqual(['doc_1']);
  });

  it('resolves expired links as expired without returning file path', async () => {
    const db = openDatabase(tempDir);
    const document = await addDocumentBoxDocument(db, {
      documentRoot: path.join(tempDir, '.od', 'document-box'),
      id: 'doc_2',
      fileName: 'brief.pdf',
      title: 'Brief',
      mimeType: 'application/pdf',
      content: Buffer.from('%PDF'),
      now: 200,
    });
    const created = createDocumentBoxLink(db, {
      id: 'link_1',
      documentId: document.id,
      token: 'secret-token',
      expiresAt: 250,
      now: 210,
    });

    const row = db.prepare('SELECT token_hash AS tokenHash FROM document_box_links WHERE id = ?').get('link_1') as {
      tokenHash: string;
    };
    expect(row.tokenHash).toBe(createHash('sha256').update('secret-token').digest('hex'));
    expect(row.tokenHash).not.toBe('secret-token');
    expect(created.token).toBe('secret-token');

    const result = resolveDocumentBoxLink(db, { token: 'secret-token', now: 300 });

    expect(result).toEqual({ status: 'expired', errorCode: 'DOCUMENT_LINK_EXPIRED' });
  });

  it('revokes links without exposing revoked documents', async () => {
    const db = openDatabase(tempDir);
    const document = await addDocumentBoxDocument(db, {
      documentRoot: path.join(tempDir, '.od', 'document-box'),
      id: 'doc_3',
      fileName: 'diagram.svg',
      title: 'Diagram',
      mimeType: 'image/svg+xml',
      content: Buffer.from('<svg />'),
      now: 400,
    });
    createDocumentBoxLink(db, {
      id: 'link_2',
      documentId: document.id,
      token: 'revoked-token',
      now: 410,
    });

    revokeDocumentBoxLink(db, 'link_2', 420);
    const result = resolveDocumentBoxLink(db, { token: 'revoked-token', now: 430 });

    expect(result).toEqual({ status: 'revoked', errorCode: 'DOCUMENT_LINK_NOT_FOUND' });
  });
});
