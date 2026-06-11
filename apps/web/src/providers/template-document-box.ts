import type {
  CreateDocumentBoxLinkRequest,
  CreateProjectFromTemplateRequest,
  CreateProjectFromTemplateResponse,
  DocumentBoxDocument,
  DocumentBoxDocumentResponse,
  DocumentBoxDocumentsResponse,
  DocumentBoxLink,
  DocumentBoxLinkResponse,
  DocumentBoxLinksResponse,
  ImportHtmlTemplateRequest,
  ProjectTemplateDetail,
  ProjectTemplateResponse,
} from '@open-design/contracts';

export async function importHtmlTemplate(
  input: ImportHtmlTemplateRequest,
): Promise<ProjectTemplateDetail | null> {
  try {
    const resp = await fetch('/api/templates/import-html', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!resp.ok) return null;
    const json = (await resp.json()) as ProjectTemplateResponse;
    return json.template;
  } catch {
    return null;
  }
}

export async function createProjectFromTemplate(
  templateId: string,
  input: CreateProjectFromTemplateRequest,
): Promise<CreateProjectFromTemplateResponse | null> {
  try {
    const resp = await fetch(`/api/templates/${encodeURIComponent(templateId)}/create-project`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!resp.ok) return null;
    return (await resp.json()) as CreateProjectFromTemplateResponse;
  } catch {
    return null;
  }
}

export async function listDocumentBoxDocuments(): Promise<readonly DocumentBoxDocument[]> {
  try {
    const resp = await fetch('/api/document-box/documents');
    if (!resp.ok) return [];
    const json = (await resp.json()) as DocumentBoxDocumentsResponse;
    return json.documents ?? [];
  } catch {
    return [];
  }
}

export async function uploadDocumentBoxDocument(input: {
  readonly file: File;
  readonly title?: string;
}): Promise<DocumentBoxDocument | null> {
  try {
    const form = new FormData();
    form.append('file', input.file);
    const title = input.title?.trim();
    if (title) form.append('title', title);
    const resp = await fetch('/api/document-box/documents', {
      method: 'POST',
      body: form,
    });
    if (!resp.ok) return null;
    const json = (await resp.json()) as DocumentBoxDocumentResponse;
    return json.document;
  } catch {
    return null;
  }
}

export async function createDocumentBoxLink(
  documentId: string,
  input: CreateDocumentBoxLinkRequest,
): Promise<DocumentBoxLink | null> {
  try {
    const resp = await fetch(`/api/document-box/documents/${encodeURIComponent(documentId)}/links`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!resp.ok) return null;
    const json = (await resp.json()) as DocumentBoxLinkResponse;
    return json.link;
  } catch {
    return null;
  }
}

export async function listDocumentBoxLinks(
  documentId: string,
): Promise<readonly DocumentBoxLink[]> {
  try {
    const resp = await fetch(`/api/document-box/documents/${encodeURIComponent(documentId)}/links`);
    if (!resp.ok) return [];
    const json = (await resp.json()) as DocumentBoxLinksResponse;
    return json.links ?? [];
  } catch {
    return [];
  }
}

export async function revokeDocumentBoxLink(linkId: string): Promise<boolean> {
  try {
    const resp = await fetch(`/api/document-box/links/${encodeURIComponent(linkId)}/revoke`, {
      method: 'POST',
    });
    return resp.ok;
  } catch {
    return false;
  }
}
