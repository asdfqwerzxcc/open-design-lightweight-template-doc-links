import type {
  DesignSystemDetail,
  PromoteProjectToDesignSystemRequest,
  PromoteProjectToDesignSystemResponse,
  Project,
  ProjectFile,
} from '@open-design/contracts';

import { createUserDesignSystem } from './design-systems.js';
import { isSafeId, listFiles, readProjectFile } from './projects.js';

export class ProjectDesignSystemPromotionError extends Error {
  constructor(
    readonly code: 'INVALID_PROJECT_ID' | 'PROJECT_NOT_FOUND',
    message: string,
  ) {
    super(message);
    this.name = 'ProjectDesignSystemPromotionError';
  }
}

export type PromoteProjectToDesignSystemOptions = {
  projectId: string;
  input: PromoteProjectToDesignSystemRequest;
  projectsRoot: string;
  userDesignSystemsRoot: string;
  getProject: (projectId: string) => Project | null;
};

type DesignBodyResult = {
  body: string;
  warnings: string[];
};

const DESIGN_FILENAME = 'DESIGN.md';

export async function promoteProjectToDesignSystem(
  options: PromoteProjectToDesignSystemOptions,
): Promise<PromoteProjectToDesignSystemResponse> {
  if (!isSafeId(options.projectId)) {
    throw new ProjectDesignSystemPromotionError('INVALID_PROJECT_ID', 'invalid project id');
  }
  const project = options.getProject(options.projectId);
  if (!project) {
    throw new ProjectDesignSystemPromotionError('PROJECT_NOT_FOUND', 'project not found');
  }

  const files: ProjectFile[] = await listFiles(options.projectsRoot, project.id, { metadata: project.metadata });
  const sourceFiles = files.map((file) => file.path || file.name);
  const title = normalizedTitle(options.input.title) || `${project.name} Design System`;
  const summary = normalizedTitle(options.input.summary) || `Promoted from project ${project.name}.`;
  const designBody = await readPromotionBody({
    files,
    project,
    projectsRoot: options.projectsRoot,
    sourceFiles,
    title,
  });
  const created = await createUserDesignSystem(options.userDesignSystemsRoot, {
    title,
    summary,
    status: options.input.status ?? 'draft',
    category: 'Project Candidate',
    surface: 'web',
    body: designBody.body,
    sourceNotes: buildSourceNotes(project, sourceFiles),
    provenance: {
      localCodeFiles: sourceFiles,
      sourceNotes: `Promoted from project ${project.id}.`,
    },
  });

  return {
    designSystem: created,
    projectId: project.id,
    sourceFiles,
    warnings: designBody.warnings,
  };
}

async function readPromotionBody(input: {
  files: ProjectFile[];
  project: Project;
  projectsRoot: string;
  sourceFiles: string[];
  title: string;
}): Promise<DesignBodyResult> {
  const designFile = input.files.find((file) => (file.path || file.name) === DESIGN_FILENAME);
  if (designFile) {
    const detail = await readProjectFile(
      input.projectsRoot,
      input.project.id,
      DESIGN_FILENAME,
      input.project.metadata,
    );
    return { body: detail.buffer.toString('utf8'), warnings: [] };
  }

  return {
    body: buildReviewRequiredDraft(input.title, input.project, input.sourceFiles),
    warnings: [`${DESIGN_FILENAME} was not found; created a review-required draft from project files.`],
  };
}

function buildReviewRequiredDraft(title: string, project: Project, sourceFiles: string[]): string {
  const files = sourceFiles.length > 0
    ? sourceFiles.map((file) => `- ${file}`).join('\n')
    : '- No project files were found.';
  return [
    `# ${title}`,
    '',
    '> Category: Project Candidate',
    '',
    '## Source project',
    '',
    `- Project: ${project.name}`,
    `- Project id: ${project.id}`,
    '',
    '## Source files',
    '',
    files,
    '',
    '## Review required',
    '',
    'This draft was promoted without a DESIGN.md source file. Review the project files, extract only source-backed decisions, and add tokens, components, and usage rules in the design-system workspace.',
    '',
  ].join('\n');
}

function buildSourceNotes(project: Project, sourceFiles: string[]): string {
  const files = sourceFiles.length > 0 ? sourceFiles.join(', ') : 'none';
  return `Source project: ${project.name} (${project.id}). Source files: ${files}.`;
}

function normalizedTitle(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
