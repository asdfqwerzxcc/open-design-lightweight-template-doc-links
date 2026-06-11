import { describe, expect, it } from 'vitest';

import {
  DOCUMENT_BOX_ERROR_CODES,
  DOCUMENT_BOX_SUPPORTED_EXTENSIONS,
  documentBoxLinkStateFromTimestamps,
} from '../src/api/document-box.js';

describe('document box contracts', () => {
  it('accepts supported document extensions for local token links', () => {
    // Given: the v1 document-box file type list.
    const expectedExtensions = [
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
    ];

    // When: consumers read the exported support matrix.
    const supportedExtensions = [...DOCUMENT_BOX_SUPPORTED_EXTENSIONS];

    // Then: every planned v1 extension is present and no implicit wildcard exists.
    expect(supportedExtensions).toEqual(expectedExtensions);
    expect(supportedExtensions).not.toContain('*');
  });

  it('rejects impossible link state by prioritizing revoked over active', () => {
    // Given: a link row with both active-looking and revoked timestamps.
    const timestamps = {
      createdAt: 1_781_102_903,
      expiresAt: 4_102_444_800,
      revokedAt: 1_781_102_904,
      now: 1_781_102_905,
    };

    // When: consumers derive public link state.
    const state = documentBoxLinkStateFromTimestamps(timestamps);

    // Then: revoked is never considered active.
    expect(state).toBe('revoked');
    expect(DOCUMENT_BOX_ERROR_CODES.revoked).toBe('DOCUMENT_LINK_NOT_FOUND');
  });

  it('classifies expired links separately from missing or revoked links', () => {
    // Given: a link whose expiry is before the current request time.
    const timestamps = {
      createdAt: 1_781_102_903,
      expiresAt: 1_781_102_904,
      revokedAt: null,
      now: 1_781_102_905,
    };

    // When: consumers derive public link state.
    const state = documentBoxLinkStateFromTimestamps(timestamps);

    // Then: expired links have their own state and HTTP error code.
    expect(state).toBe('expired');
    expect(DOCUMENT_BOX_ERROR_CODES.expired).toBe('DOCUMENT_LINK_EXPIRED');
  });
});
