import { createReadStream } from 'node:fs';
import path from 'node:path';
import type { Express, Request, Response } from 'express';
import multer from 'multer';
import {
  DOCUMENT_BOX_ERROR_CODES,
  DOCUMENT_BOX_SUPPORTED_EXTENSIONS,
  type DocumentBoxDocument,
  type DocumentBoxLink,
} from '@open-design/contracts';
import type { RouteDeps } from '../server-context.js';
import {
  addDocumentBoxDocument,
  createDocumentBoxLink,
  deleteDocumentBoxDocument,
  getDocumentBoxDocument,
  listDocumentBoxDocuments,
  listDocumentBoxLinks,
  resolveDocumentBoxLink,
  revokeDocumentBoxLink,
  type StoredDocumentBoxDocument,
  type StoredDocumentBoxLink,
} from '../document-box.js';

const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
const HTML_SANDBOX_CSP = [
  'sandbox',
  "default-src 'none'",
  "img-src data: blob:",
  "style-src 'unsafe-inline'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const supportedExtensions = new Set<string>(DOCUMENT_BOX_SUPPORTED_EXTENSIONS);

export interface RegisterDocumentBoxRoutesDeps extends RouteDeps<'db' | 'http' | 'paths' | 'resources'> {}

export function registerDocumentBoxRoutes(app: Express, ctx: RegisterDocumentBoxRoutesDeps): void {
  const { db } = ctx;
  const { sendApiError } = ctx.http;
  const { mimeFor } = ctx.resources;
  const documentRoot = path.join(ctx.paths.RUNTIME_DATA_DIR, 'document-box');
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_DOCUMENT_BYTES },
  });

  app.get('/api/document-box/documents', (_req, res) => {
    res.json({ documents: listDocumentBoxDocuments(db).map(publicDocument) });
  });

  app.post('/api/document-box/documents', (req, res) => {
    upload.single('file')(req, res, (error: unknown) => {
      void handleDocumentUpload(req, res, error);
    });
  });

  app.delete('/api/document-box/documents/:documentId', (req, res) => {
    const deleted = deleteDocumentBoxDocument(db, req.params.documentId);
    if (!deleted) {
      return sendApiError(res, 404, DOCUMENT_BOX_ERROR_CODES.documentNotFound, 'document not found');
    }
    return res.json({ ok: true });
  });

  app.post('/api/document-box/documents/:documentId/links', (req, res) => {
    const document = getDocumentBoxDocument(db, req.params.documentId);
    if (!document) {
      return sendApiError(res, 404, DOCUMENT_BOX_ERROR_CODES.documentNotFound, 'document not found');
    }
    const expiresAt = parseExpiresAt(req.body);
    if (expiresAt === 'invalid') {
      return sendApiError(res, 400, DOCUMENT_BOX_ERROR_CODES.badRequest, 'expiresAt must be a timestamp or null');
    }
    const linkInput = {
      documentId: document.id,
      ...(expiresAt === undefined ? {} : { expiresAt }),
    };
    const created = createDocumentBoxLink(db, linkInput);
    const link: DocumentBoxLink = {
      id: created.id,
      documentId: created.documentId,
      state: expiresAt !== null && expiresAt !== undefined && expiresAt <= Date.now() ? 'expired' : 'active',
      tokenUrl: `${requestOrigin(req)}/document-box/${encodeURIComponent(created.token)}`,
      expiresAt: created.expiresAt ?? null,
      createdAt: created.createdAt,
      revokedAt: null,
      lastAccessedAt: null,
    };
    return res.status(201).json({ link });
  });

  app.get('/api/document-box/documents/:documentId/links', (req, res) => {
    const document = getDocumentBoxDocument(db, req.params.documentId);
    if (!document) {
      return sendApiError(res, 404, DOCUMENT_BOX_ERROR_CODES.documentNotFound, 'document not found');
    }
    res.json({ links: listDocumentBoxLinks(db, document.id).map(publicLink) });
  });

  app.post('/api/document-box/links/:linkId/revoke', (req, res) => {
    revokeDocumentBoxLink(db, req.params.linkId);
    res.json({ ok: true });
  });

  app.get('/document-box/:token', (req, res) => {
    const resolved = resolveDocumentBoxLink(db, { token: req.params.token });
    if (resolved.status !== 'active') {
      if (resolved.status === 'expired') {
        return sendApiError(res, 410, DOCUMENT_BOX_ERROR_CODES.expired, 'document link expired');
      }
      return sendApiError(res, 404, DOCUMENT_BOX_ERROR_CODES.revoked, 'document link not found');
    }

    setDocumentHeaders(res, resolved.document);
    const stream = createReadStream(resolved.filePath);
    stream.once('error', (error) => {
      if (!res.headersSent) {
        sendApiError(res, 500, 'INTERNAL_ERROR', error instanceof Error ? error.message : String(error));
        return;
      }
      res.destroy(error instanceof Error ? error : undefined);
    });
    stream.pipe(res);
  });

  async function handleDocumentUpload(req: Request, res: Response, error: unknown): Promise<void> {
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      sendApiError(res, 413, DOCUMENT_BOX_ERROR_CODES.payloadTooLarge, 'document exceeds 25 MiB');
      return;
    }
    if (error) {
      sendApiError(res, 400, DOCUMENT_BOX_ERROR_CODES.badRequest, error instanceof Error ? error.message : String(error));
      return;
    }
    const file = req.file;
    if (!file) {
      sendApiError(res, 400, DOCUMENT_BOX_ERROR_CODES.badRequest, 'file is required');
      return;
    }
    if (!isSupportedFileName(file.originalname)) {
      sendApiError(res, 415, DOCUMENT_BOX_ERROR_CODES.unsupportedMediaType, 'unsupported document type');
      return;
    }
    const title = stringField(req.body?.title);
    const document = await addDocumentBoxDocument(db, {
      documentRoot,
      fileName: file.originalname,
      mimeType: documentMimeType(file.originalname, file.mimetype, mimeFor),
      content: file.buffer,
      ...(title === undefined ? {} : { title }),
    });
    res.status(201).json({ document: publicDocument(document) });
  }
}

function publicDocument(document: StoredDocumentBoxDocument): DocumentBoxDocument {
  return {
    id: document.id,
    title: document.title,
    fileName: document.fileName,
    mimeType: document.mimeType,
    sizeBytes: document.sizeBytes,
    sha256: document.sha256,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

function publicLink(link: StoredDocumentBoxLink): DocumentBoxLink {
  return {
    id: link.id,
    documentId: link.documentId,
    state: link.state,
    expiresAt: link.expiresAt ?? null,
    revokedAt: link.revokedAt ?? null,
    createdAt: link.createdAt,
    lastAccessedAt: link.lastAccessedAt ?? null,
  };
}

function parseExpiresAt(body: unknown): number | null | undefined | 'invalid' {
  if (!body || typeof body !== 'object' || !('expiresAt' in body)) return undefined;
  const value = (body as { readonly expiresAt?: unknown }).expiresAt;
  if (value === null || value === undefined) return null;
  return typeof value === 'number' && Number.isFinite(value) ? value : 'invalid';
}

function isSupportedFileName(fileName: string): boolean {
  return supportedExtensions.has(path.extname(fileName).toLowerCase());
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function documentMimeType(fileName: string, uploadedMimeType: string | undefined, mimeFor: (filePath: string) => string): string {
  const extensionMimeType = mimeFor(fileName);
  if (!uploadedMimeType || uploadedMimeType === 'application/octet-stream') return extensionMimeType;
  return uploadedMimeType;
}

function requestOrigin(req: Request): string {
  return `${req.protocol}://${req.get('host') ?? `127.0.0.1:${req.socket.localPort ?? 0}`}`;
}

function setDocumentHeaders(res: Response, document: StoredDocumentBoxDocument): void {
  res.setHeader('Content-Type', document.mimeType);
  res.setHeader('Content-Length', String(document.sizeBytes));
  res.setHeader('ETag', `"${document.sha256}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', `inline; filename="${headerFileName(document.fileName)}"`);
  const extension = path.extname(document.fileName).toLowerCase();
  if (extension === '.html' || extension === '.svg') {
    res.setHeader('Content-Security-Policy', HTML_SANDBOX_CSP);
  }
}

function headerFileName(fileName: string): string {
  return path.basename(fileName).replace(/[\x00-\x1F"\\]/g, '_') || 'document';
}
