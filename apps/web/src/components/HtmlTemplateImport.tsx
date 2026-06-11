import { useState, type ChangeEvent, type FormEvent } from 'react';
import type {
  CreateProjectFromTemplateResponse,
  ImportHtmlTemplateRequest,
  ProjectTemplateDetail,
} from '@open-design/contracts';
import {
  createProjectFromTemplate as defaultCreateProjectFromTemplate,
  importHtmlTemplate as defaultImportHtmlTemplate,
} from '../providers/template-document-box';
import { useT } from '../i18n';

type HtmlTemplateImportProps = {
  readonly importTemplate?: (
    input: ImportHtmlTemplateRequest,
  ) => Promise<ProjectTemplateDetail | null>;
  readonly createProject?: (
    templateId: string,
    input: { readonly name: string; readonly designSystemId: string | null },
  ) => Promise<CreateProjectFromTemplateResponse | null>;
  readonly onImported?: (template: ProjectTemplateDetail) => void;
  readonly onCreatedProject?: (projectId: string) => void;
};

function statusLabel(status: ProjectTemplateDetail['derivationStatus']): string {
  if (status === 'complete') return 'Complete';
  if (status === 'partial') return 'Partial';
  return 'Failed';
}

export function HtmlTemplateImport({
  importTemplate = defaultImportHtmlTemplate,
  createProject = defaultCreateProjectFromTemplate,
  onImported,
  onCreatedProject,
}: HtmlTemplateImportProps) {
  const t = useT();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [html, setHtml] = useState('');
  const [fileName, setFileName] = useState<string | undefined>();
  const [template, setTemplate] = useState<ProjectTemplateDetail | null>(null);
  const [projectName, setProjectName] = useState('');
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdProjectId, setCreatedProjectId] = useState<string | null>(null);

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setHtml(await file.text());
  }

  async function handleImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setCreatedProjectId(null);
    const result = await importTemplate({
      name: name.trim(),
      ...(description.trim() ? { description: description.trim() } : {}),
      html,
      ...(fileName ? { fileName } : {}),
    });
    setBusy(false);
    if (!result) {
      setError(t('newproj.htmlImportError'));
      return;
    }
    setTemplate(result);
    setProjectName((current) => current || `${result.name} project`);
    onImported?.(result);
  }

  async function handleCreateProject() {
    if (!template || creating) return;
    setCreating(true);
    setError(null);
    const result = await createProject(template.id, {
      name: projectName.trim() || `${template.name} project`,
      designSystemId: null,
    });
    setCreating(false);
    if (!result) {
      setError(t('newproj.htmlImportCreateError'));
      return;
    }
    setCreatedProjectId(result.projectId);
    onCreatedProject?.(result.projectId);
  }

  const colors = template?.designSystem?.extractedColors ?? [];
  const warnings = template?.derivationWarnings ?? template?.designSystem?.extractionWarnings ?? [];

  return (
    <section
      className="html-template-import"
      data-testid="html-template-import"
      aria-labelledby="html-template-import-title"
    >
      <div className="html-template-import__head">
        <div>
          <h3 id="html-template-import-title">{t('newproj.htmlImportTitle')}</h3>
          <p>{t('newproj.htmlImportBody')}</p>
        </div>
        {template ? (
          <span className={`html-template-import__status is-${template.derivationStatus}`}>
            {statusLabel(template.derivationStatus)}
          </span>
        ) : null}
      </div>
      <form className="html-template-import__form" onSubmit={handleImport}>
        <label>
          <span>{t('newproj.htmlImportName')}</span>
          <input
            data-testid="html-template-import-name"
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
            required
          />
        </label>
        <label>
          <span>{t('newproj.htmlImportDescription')}</span>
          <input
            value={description}
            onChange={(event) => setDescription(event.currentTarget.value)}
          />
        </label>
        <label>
          <span>{t('newproj.htmlImportFile')}</span>
          <input accept=".html,.htm,text/html" type="file" onChange={handleFile} />
        </label>
        <label>
          <span>{t('newproj.htmlImportSource')}</span>
          <textarea
            data-testid="html-template-import-source"
            value={html}
            onChange={(event) => setHtml(event.currentTarget.value)}
            rows={6}
            required
          />
        </label>
        <button
          type="submit"
          className="primary"
          data-testid="html-template-import-submit"
          disabled={busy || !name.trim() || !html.trim()}
        >
          {busy ? t('newproj.htmlImportImporting') : t('newproj.htmlImportAction')}
        </button>
      </form>
      {template ? (
        <div className="html-template-import__result">
          {colors.length > 0 ? (
            <div className="html-template-import__colors" aria-label="Extracted colors">
              {colors.map((color) => (
                <span key={color} className="html-template-import__swatch">
                  <span style={{ backgroundColor: color }} aria-hidden />
                  {color}
                </span>
              ))}
            </div>
          ) : null}
          {warnings.length > 0 ? (
            <ul className="html-template-import__warnings">
              {warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : null}
          <div className="html-template-import__create">
            <label>
              <span>{t('newproj.htmlImportProjectName')}</span>
              <input
                data-testid="html-template-project-name"
                value={projectName}
                onChange={(event) => setProjectName(event.currentTarget.value)}
              />
            </label>
            <button
              type="button"
              className="primary"
              data-testid="html-template-create-project"
              disabled={creating}
              onClick={handleCreateProject}
            >
              {creating ? t('newproj.htmlImportCreating') : t('newproj.htmlImportCreateProject')}
            </button>
          </div>
        </div>
      ) : null}
      {createdProjectId ? (
        <p className="html-template-import__notice">
          {t('newproj.htmlImportCreatedProject', { id: createdProjectId })}
        </p>
      ) : null}
      {error ? <p className="html-template-import__error" role="alert">{error}</p> : null}
    </section>
  );
}
