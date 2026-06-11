export const TEMPLATE_SOURCE_KINDS = ['project-snapshot', 'html-import'] as const;

export type TemplateSourceKind = (typeof TEMPLATE_SOURCE_KINDS)[number];

export const TEMPLATE_DERIVATION_STATUSES = ['complete', 'partial', 'failed'] as const;

export type TemplateDerivationStatus =
  (typeof TEMPLATE_DERIVATION_STATUSES)[number];

export const PROJECT_TEMPLATE_FILE_KINDS = ['html', 'text', 'code'] as const;

export type ProjectTemplateFileKind = (typeof PROJECT_TEMPLATE_FILE_KINDS)[number];

export type DesignSystemProjectManifestFiles = {
  readonly design: 'DESIGN.md';
  readonly tokens: 'tokens.css';
  readonly components?: 'components.html';
};

export type DesignSystemProjectManifestSummary = {
  readonly schemaVersion: 'od-design-system-project/v1';
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly description?: string;
  readonly files: DesignSystemProjectManifestFiles;
};

export type ProjectTemplateFile = {
  readonly name: string;
  readonly content: string;
  readonly kind: ProjectTemplateFileKind;
};

export type ProjectTemplateDesignSystem = {
  readonly manifest: DesignSystemProjectManifestSummary;
  readonly designMd: string;
  readonly tokensCss: string;
  readonly componentsHtml?: string;
  readonly extractedColors: readonly string[];
  readonly extractionWarnings: readonly string[];
};

export type ProjectTemplateDetail = {
  readonly id: string;
  readonly name: string;
  readonly sourceKind: TemplateSourceKind;
  readonly sourceProjectId?: string;
  readonly description?: string;
  readonly files: readonly ProjectTemplateFile[];
  readonly htmlSource?: string;
  readonly designSystem?: ProjectTemplateDesignSystem;
  readonly derivationStatus: TemplateDerivationStatus;
  readonly derivationWarnings: readonly string[];
  readonly createdAt: number;
  readonly updatedAt?: number;
};

export type ProjectTemplateSummary = {
  readonly id: string;
  readonly name: string;
  readonly sourceKind: TemplateSourceKind;
  readonly sourceProjectId?: string;
  readonly description?: string;
  readonly derivationStatus: TemplateDerivationStatus;
  readonly derivationWarnings: readonly string[];
  readonly fileCount: number;
  readonly extractedColors: readonly string[];
  readonly createdAt: number;
  readonly updatedAt?: number;
};

export type ImportHtmlTemplateRequest = {
  readonly name: string;
  readonly description?: string;
  readonly html?: string;
  readonly fileName?: string;
  readonly sourceProjectId?: string;
  readonly sourceFileName?: string;
};

export type CreateProjectFromTemplateRequest = {
  readonly name: string;
  readonly designSystemId?: string | null;
};

export type ProjectTemplateResponse = {
  readonly template: ProjectTemplateDetail;
};

export type ProjectTemplatesResponse = {
  readonly templates: readonly ProjectTemplateSummary[];
};

export type CreateProjectFromTemplateResponse = {
  readonly projectId: string;
  readonly conversationId?: string;
  readonly template: ProjectTemplateSummary;
};

export function buildProjectTemplateSummary(
  template: ProjectTemplateDetail,
): ProjectTemplateSummary {
  return {
    id: template.id,
    name: template.name,
    sourceKind: template.sourceKind,
    ...(template.sourceProjectId === undefined
      ? {}
      : { sourceProjectId: template.sourceProjectId }),
    ...(template.description === undefined
      ? {}
      : { description: template.description }),
    derivationStatus: template.derivationStatus,
    derivationWarnings: template.derivationWarnings,
    fileCount: template.files.length,
    extractedColors: template.designSystem?.extractedColors ?? [],
    createdAt: template.createdAt,
    ...(template.updatedAt === undefined ? {} : { updatedAt: template.updatedAt }),
  };
}
