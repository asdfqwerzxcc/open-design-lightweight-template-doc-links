import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type {
  DesignSystemDetail,
  DesignSystemStaticHtmlExportResponse,
} from '@open-design/contracts';

import {
  listDesignSystems,
  readDesignSystemPackageInfo,
} from './design-systems.js';
import type { DesignSystemSummary } from './design-systems.js';
import {
  renderComponentsBody,
  renderDesignSystemBody,
  renderExamplesBody,
  renderPreformattedBody,
  renderStaticExportIndex,
  renderStaticExportPage,
} from './design-system-static-export-html.js';
import {
  copyStaticExportAssetDir,
  copyStaticExportPackageFile,
  isNodeError,
  listStaticExportPreviewPages,
  readStaticExportPackageText,
  slugifyStaticExportName,
  staticExportStamp,
  toPosixPath,
} from './design-system-static-export-files.js';

export type DesignSystemStaticExportErrorCode =
  | 'DESIGN_SYSTEM_NOT_FOUND'
  | 'EXPORT_FOLDER_EXISTS'
  | 'INVALID_OUTPUT_PATH';

export class DesignSystemStaticExportError extends Error {
  constructor(
    public readonly code: DesignSystemStaticExportErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DesignSystemStaticExportError';
  }
}

export type ExportDesignSystemStaticHtmlOptions = {
  designSystemId: string;
  builtInRoot: string;
  userRoot: string;
  outDir: string;
  includeSourceEvidence?: boolean;
  now?: Date;
};

type ResolvedDesignSystem = {
  detail: DesignSystemDetail;
  packageRoot: string;
  idPrefix?: string;
};

export async function exportDesignSystemStaticHtml(
  options: ExportDesignSystemStaticHtmlOptions,
): Promise<DesignSystemStaticHtmlExportResponse> {
  const resolved = await resolveDesignSystem(options);
  if (!resolved) {
    throw new DesignSystemStaticExportError(
      'DESIGN_SYSTEM_NOT_FOUND',
      `design system not found: ${options.designSystemId}`,
    );
  }

  const warnings = new Set<string>();
  const manifest = resolved.detail.packageInfo?.manifest;
  const outParent = path.resolve(options.outDir);
  const folderName = `${slugifyStaticExportName(resolved.detail.title)}-static-html-${staticExportStamp(options.now ?? new Date())}`;
  const folder = path.join(outParent, folderName);
  try {
    await mkdir(outParent, { recursive: true });
    await mkdir(folder, { recursive: false });
  } catch (err) {
    if (isNodeError(err) && err.code === 'EEXIST') {
      throw new DesignSystemStaticExportError(
        'EXPORT_FOLDER_EXISTS',
        `static export folder already exists: ${folder}`,
      );
    }
    throw new DesignSystemStaticExportError('INVALID_OUTPUT_PATH', String(err));
  }

  const files: string[] = [];
  const writeText = async (relativePath: string, content: string): Promise<void> => {
    const target = path.join(folder, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, 'utf8');
    files.push(toPosixPath(relativePath));
  };
  const copyPackageFile = (sourcePath: string, targetPath = sourcePath): Promise<boolean> =>
    copyStaticExportPackageFile(resolved.packageRoot, folder, sourcePath, files, warnings, targetPath);
  const readPackageText = (sourcePath: string | undefined): Promise<string | undefined> =>
    readStaticExportPackageText(resolved.packageRoot, sourcePath, warnings);
  const readFirstPackageText = async (sourcePaths: Array<string | undefined>): Promise<string | undefined> => {
    for (const sourcePath of sourcePaths) {
      const text = await readPackageText(sourcePath);
      if (text !== undefined) return text;
    }
    return undefined;
  };

  const tokens = await readFirstPackageText([manifest?.files?.tokens, 'tokens.css', 'colors_and_type.css']);
  const components = await readFirstPackageText([manifest?.files?.components, 'components.html']);
  const componentsManifest = await readPackageText(manifest?.componentsManifest ?? 'components.manifest.json');
  const manifestPreviewPaths = (manifest?.preview?.pages ?? [])
    .map((page) => typeof page.path === 'string' ? page.path : '')
    .filter((page) => page.length > 0);
  const previewPaths = manifestPreviewPaths.length > 0
    ? manifestPreviewPaths
    : await listStaticExportPreviewPages(resolved.packageRoot);
  const copiedPreviews: string[] = [];
  for (const pagePath of previewPaths) {
    if (await copyPackageFile(pagePath)) copiedPreviews.push(pagePath);
  }
  await copyStaticExportAssetDir(resolved.packageRoot, folder, manifest?.assetsDir ?? 'assets', files, warnings);
  const evidence = options.includeSourceEvidence === false
    ? undefined
    : await readFirstPackageText([manifest?.sourceFiles?.evidence, 'context/provenance.md']);
  const qualityReport = options.includeSourceEvidence === false
    ? undefined
    : await readPackageText(manifest?.sourceFiles?.report);
  const componentPreviews = copiedPreviews.filter((preview) =>
    path.basename(preview).startsWith('components-')
  );

  await writeText('design-system.html', renderStaticExportPage(
    resolved.detail.title,
    renderDesignSystemBody(resolved.detail),
  ));
  if (tokens) {
    await writeText('tokens.html', renderStaticExportPage(
      `${resolved.detail.title} Tokens`,
      renderPreformattedBody(tokens),
    ));
  }
  if (components || componentsManifest || componentPreviews.length > 0) {
    await writeText('components.html', renderStaticExportPage(
      `${resolved.detail.title} Components`,
      renderComponentsBody(components, componentsManifest, componentPreviews),
    ));
  }
  if (copiedPreviews.length > 0) {
    await writeText('examples.html', renderStaticExportPage(
      `${resolved.detail.title} Examples`,
      renderExamplesBody(copiedPreviews),
    ));
  }
  if (evidence) {
    await writeText('source-evidence.html', renderStaticExportPage(
      `${resolved.detail.title} Source Evidence`,
      renderPreformattedBody(evidence),
    ));
  }
  if (qualityReport) {
    await writeText('quality-report.html', renderStaticExportPage(
      `${resolved.detail.title} Quality Report`,
      renderPreformattedBody(qualityReport),
    ));
  }
  await writeText('data/design-system.json', `${JSON.stringify({
    designSystem: resolved.detail,
    exportedAt: (options.now ?? new Date()).toISOString(),
    files: files.slice().sort(),
  }, null, 2)}\n`);
  await writeText('README.md', `# ${resolved.detail.title} static HTML export\n\nOpen index.html in a browser. This package is self-contained and does not require Open Design to be running.\n`);
  await writeText('index.html', renderStaticExportPage(
    resolved.detail.title,
    renderStaticExportIndex(resolved.detail, files),
  ));

  return {
    export: {
      designSystemId: resolved.detail.id,
      folder,
      entryFile: path.join(folder, 'index.html'),
      files: files.slice().sort(),
      warnings: [...warnings].sort(),
    },
  };
}

async function resolveDesignSystem(
  options: ExportDesignSystemStaticHtmlOptions,
): Promise<ResolvedDesignSystem | null> {
  if (options.designSystemId.startsWith('user:')) {
    return resolveFromRoot(options.userRoot, options.designSystemId, 'user:');
  }
  return (
    await resolveFromRoot(options.builtInRoot, options.designSystemId)
    ?? await resolveFromRoot(options.userRoot, options.designSystemId)
    ?? await resolveFromRoot(options.userRoot, options.designSystemId, 'user:')
  );
}

async function resolveFromRoot(root: string, id: string, idPrefix?: string): Promise<ResolvedDesignSystem | null> {
  const systems = await listDesignSystems(root, {
    ...(idPrefix ? { idPrefix } : {}),
    ...(idPrefix === 'user:' ? { source: 'user', isEditable: true, defaultStatus: 'draft' } : {}),
  });
  const summary = systems.find((system) => system.id === id);
  if (!summary) return null;
  const packageInfo = await readDesignSystemPackageInfo(root, id, idPrefix ? { idPrefix } : {});
  const detail = { ...summary, ...(packageInfo ? { packageInfo } : {}) };
  const dirId = idPrefix && id.startsWith(idPrefix) ? id.slice(idPrefix.length) : id;
  return {
    detail: detailFromSummary(detail),
    packageRoot: path.join(root, dirId),
    ...(idPrefix ? { idPrefix } : {}),
  };
}

function detailFromSummary(summary: DesignSystemSummary & Pick<DesignSystemDetail, 'packageInfo'>): DesignSystemDetail {
  return summary;
}
