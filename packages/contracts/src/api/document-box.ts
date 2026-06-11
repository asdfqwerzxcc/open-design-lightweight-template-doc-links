export const DOCUMENT_BOX_SUPPORTED_EXTENSIONS = [
  '.pdf',
  '.docx',
  '.pptx',
  '.xlsx',
  '.txt',
  '.md',
  '.html',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.svg',
] as const;

export type DocumentBoxSupportedExtension =
  (typeof DOCUMENT_BOX_SUPPORTED_EXTENSIONS)[number];

export const DOCUMENT_BOX_LINK_STATES = [
  'active',
  'expired',
  'revoked',
] as const;

export type DocumentBoxLinkState = (typeof DOCUMENT_BOX_LINK_STATES)[number];

export const DOCUMENT_BOX_ERROR_CODES = {
  badRequest: 'BAD_REQUEST',
  documentNotFound: 'DOCUMENT_NOT_FOUND',
  expired: 'DOCUMENT_LINK_EXPIRED',
  payloadTooLarge: 'PAYLOAD_TOO_LARGE',
  revoked: 'DOCUMENT_LINK_NOT_FOUND',
  unsupportedMediaType: 'UNSUPPORTED_MEDIA_TYPE',
} as const;

export type DocumentBoxErrorCode =
  (typeof DOCUMENT_BOX_ERROR_CODES)[keyof typeof DOCUMENT_BOX_ERROR_CODES];

export type DocumentBoxDocument = {
  readonly id: string;
  readonly title: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly createdAt: number;
  readonly updatedAt: number;
};

export type DocumentBoxLink = {
  readonly id: string;
  readonly documentId: string;
  readonly state: DocumentBoxLinkState;
  readonly tokenUrl?: string;
  readonly expiresAt?: number | null;
  readonly revokedAt?: number | null;
  readonly createdAt: number;
  readonly lastAccessedAt?: number | null;
};

export type DocumentBoxDocumentsResponse = {
  readonly documents: readonly DocumentBoxDocument[];
};

export type DocumentBoxDocumentResponse = {
  readonly document: DocumentBoxDocument;
};

export type DocumentBoxLinksResponse = {
  readonly links: readonly DocumentBoxLink[];
};

export type DocumentBoxLinkResponse = {
  readonly link: DocumentBoxLink;
};

export type CreateDocumentBoxLinkRequest = {
  readonly expiresAt?: number | null;
};

export type DocumentBoxLinkTimestampInput = {
  readonly createdAt: number;
  readonly expiresAt?: number | null;
  readonly revokedAt?: number | null;
  readonly now: number;
};

export function documentBoxLinkStateFromTimestamps(
  input: DocumentBoxLinkTimestampInput,
): DocumentBoxLinkState {
  if (input.revokedAt !== null && input.revokedAt !== undefined) {
    return 'revoked';
  }
  if (
    input.expiresAt !== null &&
    input.expiresAt !== undefined &&
    input.expiresAt <= input.now
  ) {
    return 'expired';
  }
  return 'active';
}
