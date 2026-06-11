import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type Database from 'better-sqlite3';
import {
  DOCUMENT_BOX_ERROR_CODES,
  type DocumentBoxLink,
  documentBoxLinkStateFromTimestamps,
  type DocumentBoxDocument,
  type DocumentBoxLinkState,
} from '@open-design/contracts';

type SqliteDb = Database.Database;
type DbRow = Record<string, unknown>;
export type StoredDocumentBoxDocument = DocumentBoxDocument & {
  storedPath: string;
  deletedAt?: number;
};
export type StoredDocumentBoxLink = DocumentBoxLink & {
  tokenHash: string;
};

export interface AddDocumentBoxDocumentInput {
  documentRoot: string;
  id?: string;
  fileName: string;
  title?: string;
  mimeType: string;
  content: Buffer;
  now?: number;
}

export interface CreateDocumentBoxLinkInput {
  id?: string;
  documentId: string;
  token?: string;
  expiresAt?: number | null;
  now?: number;
}

export type ResolveDocumentBoxLinkResult =
  | { status: 'active'; document: StoredDocumentBoxDocument; filePath: string; linkId: string }
  | { status: Exclude<DocumentBoxLinkState, 'active'> | 'not_found'; errorCode: string };

export async function addDocumentBoxDocument(
  db: SqliteDb,
  input: AddDocumentBoxDocumentInput,
): Promise<StoredDocumentBoxDocument> {
  const id = input.id ?? randomUUID();
  const fileName = safeFileName(input.fileName);
  const now = input.now ?? Date.now();
  const directory = path.resolve(input.documentRoot, id);
  const storedPath = path.join(directory, fileName);
  const sha256 = createHash('sha256').update(input.content).digest('hex');

  await mkdir(directory, { recursive: true });
  await writeFile(storedPath, input.content);
  db.prepare(
    `INSERT INTO document_box_documents (
       id, title, file_name, stored_path, mime_type, size_bytes, sha256,
       created_at, updated_at, deleted_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
  ).run(
    id,
    input.title?.trim() || fileName,
    fileName,
    storedPath,
    input.mimeType,
    input.content.length,
    sha256,
    now,
    now,
  );

  return getDocumentBoxDocument(db, id) as StoredDocumentBoxDocument;
}

export function listDocumentBoxDocuments(db: SqliteDb): StoredDocumentBoxDocument[] {
  return (db
    .prepare(
      `SELECT id, title, file_name AS fileName, stored_path AS storedPath,
              mime_type AS mimeType, size_bytes AS sizeBytes, sha256,
              created_at AS createdAt, updated_at AS updatedAt, deleted_at AS deletedAt
         FROM document_box_documents
        WHERE deleted_at IS NULL
        ORDER BY created_at DESC`,
    )
    .all() as DbRow[]).map(normalizeDocument);
}

export function getDocumentBoxDocument(db: SqliteDb, id: string): StoredDocumentBoxDocument | null {
  const row = db
    .prepare(
      `SELECT id, title, file_name AS fileName, stored_path AS storedPath,
              mime_type AS mimeType, size_bytes AS sizeBytes, sha256,
              created_at AS createdAt, updated_at AS updatedAt, deleted_at AS deletedAt
         FROM document_box_documents
        WHERE id = ? AND deleted_at IS NULL`,
    )
    .get(id) as DbRow | undefined;
  return row ? normalizeDocument(row) : null;
}

export function deleteDocumentBoxDocument(db: SqliteDb, documentId: string, now = Date.now()): boolean {
  const document = getDocumentBoxDocument(db, documentId);
  if (!document) return false;
  const result = db
    .prepare(
      `UPDATE document_box_documents
          SET deleted_at = ?, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL`,
    )
    .run(now, now, documentId);
  if (result.changes === 0) return false;
  db.prepare(
    `UPDATE document_box_links
        SET revoked_at = COALESCE(revoked_at, ?)
      WHERE document_id = ?`,
  ).run(now, documentId);
  rmSync(document.storedPath, { force: true });
  return true;
}

export function createDocumentBoxLink(db: SqliteDb, input: CreateDocumentBoxLinkInput): {
  id: string;
  documentId: string;
  token: string;
  tokenHash: string;
  expiresAt?: number;
  createdAt: number;
} {
  const id = input.id ?? randomUUID();
  const token = input.token ?? randomBytes(32).toString('base64url');
  const tokenHash = hashToken(token);
  const now = input.now ?? Date.now();
  db.prepare(
    `INSERT INTO document_box_links (
       id, document_id, token_hash, expires_at, revoked_at, created_at, last_accessed_at
     )
     VALUES (?, ?, ?, ?, NULL, ?, NULL)`,
  ).run(id, input.documentId, tokenHash, input.expiresAt ?? null, now);

  const result = {
    id,
    documentId: input.documentId,
    token,
    tokenHash,
    createdAt: now,
  };
  return input.expiresAt === null || input.expiresAt === undefined
    ? result
    : { ...result, expiresAt: input.expiresAt };
}

export function revokeDocumentBoxLink(db: SqliteDb, linkId: string, now = Date.now()): void {
  db.prepare(`UPDATE document_box_links SET revoked_at = ? WHERE id = ?`).run(now, linkId);
}

export function listDocumentBoxLinks(db: SqliteDb, documentId: string, now = Date.now()): StoredDocumentBoxLink[] {
  return (db
    .prepare(
      `SELECT id, document_id AS documentId, token_hash AS tokenHash,
              expires_at AS expiresAt, revoked_at AS revokedAt,
              created_at AS createdAt, last_accessed_at AS lastAccessedAt
         FROM document_box_links
        WHERE document_id = ?
        ORDER BY created_at DESC`,
    )
    .all(documentId) as DbRow[]).map((row) => normalizeLink(row, now));
}

export function resolveDocumentBoxLink(
  db: SqliteDb,
  input: { token: string; now?: number },
): ResolveDocumentBoxLinkResult {
  const row = db
    .prepare(
      `SELECT l.id AS linkId, l.created_at AS linkCreatedAt, l.expires_at AS expiresAt,
              l.revoked_at AS revokedAt, d.id, d.title, d.file_name AS fileName,
              d.stored_path AS storedPath, d.mime_type AS mimeType, d.size_bytes AS sizeBytes,
              d.sha256, d.created_at AS createdAt, d.updated_at AS updatedAt, d.deleted_at AS deletedAt
         FROM document_box_links l
         JOIN document_box_documents d ON d.id = l.document_id
        WHERE l.token_hash = ?`,
    )
    .get(hashToken(input.token)) as DbRow | undefined;
  if (!row || row.deletedAt !== null) return { status: 'not_found', errorCode: DOCUMENT_BOX_ERROR_CODES.documentNotFound };

  const state = documentBoxLinkStateFromTimestamps({
    createdAt: Number(row.linkCreatedAt),
    expiresAt: numberOrNull(row.expiresAt),
    revokedAt: numberOrNull(row.revokedAt),
    now: input.now ?? Date.now(),
  });
  if (state === 'expired') return { status: 'expired', errorCode: DOCUMENT_BOX_ERROR_CODES.expired };
  if (state === 'revoked') return { status: 'revoked', errorCode: DOCUMENT_BOX_ERROR_CODES.revoked };

  db.prepare(`UPDATE document_box_links SET last_accessed_at = ? WHERE id = ?`).run(input.now ?? Date.now(), row.linkId);
  return {
    status: 'active',
    document: normalizeDocument(row),
    filePath: String(row.storedPath),
    linkId: String(row.linkId),
  };
}

function normalizeDocument(row: DbRow): StoredDocumentBoxDocument {
  const document = {
    id: String(row.id),
    title: String(row.title),
    fileName: String(row.fileName),
    mimeType: String(row.mimeType),
    sizeBytes: Number(row.sizeBytes),
    sha256: String(row.sha256),
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
    storedPath: String(row.storedPath),
  };
  const deletedAt = numberOrUndefined(row.deletedAt);
  return deletedAt === undefined ? document : { ...document, deletedAt };
}

function normalizeLink(row: DbRow, now: number): StoredDocumentBoxLink {
  const expiresAt = numberOrNull(row.expiresAt);
  const revokedAt = numberOrNull(row.revokedAt);
  const createdAt = Number(row.createdAt);
  return {
    id: String(row.id),
    documentId: String(row.documentId),
    tokenHash: String(row.tokenHash),
    state: documentBoxLinkStateFromTimestamps({
      createdAt,
      expiresAt,
      revokedAt,
      now,
    }),
    expiresAt,
    revokedAt,
    createdAt,
    lastAccessedAt: numberOrNull(row.lastAccessedAt),
  };
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function safeFileName(fileName: string): string {
  const base = path.basename(fileName).replace(/[<>:"/\\|?*\x00-\x1F]/g, '-').trim();
  return base && base !== '.' && base !== '..' ? base : 'document';
}

function numberOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function numberOrUndefined(value: unknown): number | undefined {
  return value === null || value === undefined ? undefined : Number(value);
}
