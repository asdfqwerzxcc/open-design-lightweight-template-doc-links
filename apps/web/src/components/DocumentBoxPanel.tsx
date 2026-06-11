import { useEffect, useState, type ChangeEvent } from 'react';
import type { DocumentBoxDocument, DocumentBoxLink } from '@open-design/contracts';
import {
  createDocumentBoxLink as defaultCreateDocumentBoxLink,
  listDocumentBoxDocuments as defaultListDocumentBoxDocuments,
  listDocumentBoxLinks as defaultListDocumentBoxLinks,
  revokeDocumentBoxLink as defaultRevokeDocumentBoxLink,
  uploadDocumentBoxDocument as defaultUploadDocumentBoxDocument,
} from '../providers/template-document-box';
import { useT } from '../i18n';

type DocumentBoxPanelProps = {
  readonly listDocuments?: () => Promise<readonly DocumentBoxDocument[]>;
  readonly uploadDocument?: (input: {
    readonly file: File;
    readonly title?: string;
  }) => Promise<DocumentBoxDocument | null>;
  readonly createLink?: (
    documentId: string,
    input: { readonly expiresAt?: number | null },
  ) => Promise<DocumentBoxLink | null>;
  readonly listLinks?: (documentId: string) => Promise<readonly DocumentBoxLink[]>;
  readonly revokeLink?: (linkId: string) => Promise<boolean>;
};

type LinksByDocument = Record<string, readonly DocumentBoxLink[]>;

function stateLabel(state: DocumentBoxLink['state']): string {
  if (state === 'active') return 'Active';
  if (state === 'expired') return 'Expired';
  return 'Revoked';
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 102.4) / 10} KB`;
  return `${Math.round(bytes / 104857.6) / 10} MB`;
}

export function DocumentBoxPanel({
  listDocuments = defaultListDocumentBoxDocuments,
  uploadDocument = defaultUploadDocumentBoxDocument,
  createLink = defaultCreateDocumentBoxLink,
  listLinks = defaultListDocumentBoxLinks,
  revokeLink = defaultRevokeDocumentBoxLink,
}: DocumentBoxPanelProps) {
  const t = useT();
  const [documents, setDocuments] = useState<readonly DocumentBoxDocument[]>([]);
  const [linksByDocument, setLinksByDocument] = useState<LinksByDocument>({});
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const nextDocuments = await listDocuments();
      if (cancelled) return;
      setDocuments(nextDocuments);
      const entries = await Promise.all(
        nextDocuments.map(async (documentRecord) => [
          documentRecord.id,
          await listLinks(documentRecord.id),
        ] as const),
      );
      if (!cancelled) setLinksByDocument(Object.fromEntries(entries));
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [listDocuments, listLinks]);

  function handleFile(event: ChangeEvent<HTMLInputElement>) {
    setFile(event.currentTarget.files?.[0] ?? null);
  }

  async function handleUpload() {
    if (!file || busy) return;
    setBusy(true);
    setMessage(null);
    const documentRecord = await uploadDocument({
      file,
      ...(title.trim() ? { title: title.trim() } : {}),
    });
    setBusy(false);
    if (!documentRecord) {
      setMessage(t('documentBox.uploadError'));
      return;
    }
    setDocuments((current) => [documentRecord, ...current]);
    setLinksByDocument((current) => ({ ...current, [documentRecord.id]: [] }));
    setFile(null);
    setTitle('');
  }

  async function handleCreateLink(documentRecord: DocumentBoxDocument) {
    const parsedExpiry = expiresAt ? Date.parse(expiresAt) : Number.NaN;
    const link = await createLink(documentRecord.id, {
      expiresAt: Number.isFinite(parsedExpiry) ? parsedExpiry : null,
    });
    if (!link) {
      setMessage(t('documentBox.linkError'));
      return;
    }
    setLinksByDocument((current) => ({
      ...current,
      [documentRecord.id]: [link, ...(current[documentRecord.id] ?? [])],
    }));
  }

  async function handleRevoke(link: DocumentBoxLink) {
    const ok = await revokeLink(link.id);
    if (!ok) {
      setMessage(t('documentBox.revokeError'));
      return;
    }
    setLinksByDocument((current) => {
      const nextLinks = (current[link.documentId] ?? []).map((item) =>
        item.id === link.id ? { ...item, state: 'revoked' as const, tokenUrl: undefined } : item,
      );
      return { ...current, [link.documentId]: nextLinks };
    });
  }

  async function copyLink(tokenUrl: string | undefined) {
    if (!tokenUrl) return;
    await navigator.clipboard?.writeText(tokenUrl);
    setMessage(t('documentBox.copied'));
  }

  return (
    <section
      className="document-box-panel"
      data-testid="document-box-panel"
      aria-labelledby="document-box-title"
    >
      <header className="document-box-panel__head">
        <div>
          <p className="document-box-panel__kicker">{t('documentBox.kicker')}</p>
          <h2 id="document-box-title">{t('documentBox.title')}</h2>
          <p>{t('documentBox.body')}</p>
        </div>
      </header>
      <div className="document-box-panel__upload">
        <label>
          <span>{t('documentBox.fileLabel')}</span>
          <input data-testid="document-box-file" type="file" onChange={handleFile} />
        </label>
        <label>
          <span>{t('documentBox.titleLabel')}</span>
          <input
            data-testid="document-box-title-input"
            value={title}
            onChange={(event) => setTitle(event.currentTarget.value)}
          />
        </label>
        <button
          type="button"
          className="primary"
          data-testid="document-box-upload"
          disabled={!file || busy}
          onClick={handleUpload}
        >
          {busy ? t('documentBox.uploading') : t('documentBox.upload')}
        </button>
      </div>
      <label className="document-box-panel__expiry">
        <span>{t('documentBox.expiry')}</span>
        <input
          type="datetime-local"
          value={expiresAt}
          onChange={(event) => setExpiresAt(event.currentTarget.value)}
        />
      </label>
      {documents.length === 0 ? (
        <p className="document-box-panel__empty">{t('documentBox.empty')}</p>
      ) : (
        <div className="document-box-panel__list">
          {documents.map((documentRecord) => (
            <article
              className="document-box-panel__document"
              data-testid={`document-box-doc-${documentRecord.id}`}
              key={documentRecord.id}
            >
              <div className="document-box-panel__document-main">
                <div>
                  <h3>{documentRecord.title}</h3>
                  <p>{documentRecord.fileName} · {formatSize(documentRecord.sizeBytes)}</p>
                </div>
                <button
                  type="button"
                  className="primary"
                  data-testid={`document-box-create-link-${documentRecord.id}`}
                  onClick={() => void handleCreateLink(documentRecord)}
                  aria-label={t('documentBox.createLinkAria', { title: documentRecord.title })}
                >
                  {t('documentBox.createLink')}
                </button>
              </div>
              <div className="document-box-panel__links">
                {(linksByDocument[documentRecord.id] ?? []).map((link) => (
                  <div className="document-box-panel__link" key={link.id}>
                    <span className={`document-box-panel__state is-${link.state}`}>
                      {stateLabel(link.state)}
                    </span>
                    {link.tokenUrl ? <code>{link.tokenUrl}</code> : <span>{link.id}</span>}
                    <button type="button" onClick={() => void copyLink(link.tokenUrl)}>
                      {t('documentBox.copyLink')}
                    </button>
                    {link.state === 'active' ? (
                      <button
                        type="button"
                        data-testid={`document-box-revoke-link-${link.id}`}
                        onClick={() => void handleRevoke(link)}
                      >
                        {t('documentBox.revokeLink')}
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      )}
      {message ? <p className="document-box-panel__message" role="status">{message}</p> : null}
    </section>
  );
}
