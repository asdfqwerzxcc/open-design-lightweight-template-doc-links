// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DocumentBoxPanel } from '../../src/components/DocumentBoxPanel';
import type { DocumentBoxDocument, DocumentBoxLink } from '@open-design/contracts';

const documentRecord: DocumentBoxDocument = {
  id: 'doc_1',
  title: 'Launch brief',
  fileName: 'launch.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 1024,
  sha256: 'abc',
  createdAt: 1760000000000,
  updatedAt: 1760000000000,
};

const activeLink: DocumentBoxLink = {
  id: 'link_1',
  documentId: 'doc_1',
  state: 'active',
  tokenUrl: 'http://127.0.0.1:3000/document-box/token',
  expiresAt: null,
  createdAt: 1760000000000,
  lastAccessedAt: null,
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('DocumentBoxPanel', () => {
  it('uploads a document, creates a link, copies it, and revokes it', async () => {
    const listDocuments = vi.fn(async () => []);
    const uploadDocument = vi.fn(async () => documentRecord);
    const listLinks = vi.fn(async () => []);
    const createLink = vi.fn(async () => activeLink);
    const revokeLink = vi.fn(async () => true);
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    render(
      <DocumentBoxPanel
        listDocuments={listDocuments}
        uploadDocument={uploadDocument}
        listLinks={listLinks}
        createLink={createLink}
        revokeLink={revokeLink}
      />,
    );

    await screen.findByText('No documents registered yet.');
    fireEvent.change(screen.getByLabelText('Document file'), {
      target: { files: [new File(['pdf'], 'launch.pdf', { type: 'application/pdf' })] },
    });
    fireEvent.change(screen.getByLabelText('Document title'), {
      target: { value: 'Launch brief' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Upload document' }));

    const row = await screen.findByTestId('document-box-doc-doc_1');
    expect(within(row).getByText('Launch brief')).toBeTruthy();

    fireEvent.click(within(row).getByRole('button', { name: 'Create link for Launch brief' }));
    await screen.findByText(activeLink.tokenUrl ?? '');
    fireEvent.click(screen.getByRole('button', { name: 'Copy document link' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(activeLink.tokenUrl));

    fireEvent.click(screen.getByRole('button', { name: 'Revoke document link' }));
    await waitFor(() => expect(revokeLink).toHaveBeenCalledWith('link_1'));
    expect(screen.getByText('Revoked')).toBeTruthy();
  });

  it('loads existing documents and marks expired links', async () => {
    const expired: DocumentBoxLink = {
      ...activeLink,
      id: 'link_expired',
      state: 'expired',
      expiresAt: 1759999999000,
      tokenUrl: undefined,
    };

    render(
      <DocumentBoxPanel
        listDocuments={vi.fn(async () => [documentRecord])}
        uploadDocument={vi.fn()}
        listLinks={vi.fn(async () => [expired])}
        createLink={vi.fn()}
        revokeLink={vi.fn()}
      />,
    );

    await screen.findByText('Launch brief');
    expect(await screen.findByText('Expired')).toBeTruthy();
  });
});
