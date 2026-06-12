import type { DesignSystemRequestCreateRequest, DesignSystemRequestSource } from '@open-design/contracts';
import type { DesignSystemSummary, ProjectMetadata } from '../types';

export type DesignSystemRequestMode = 'home-multi' | 'project-single';

export interface DesignSystemRequestPrimitiveInput {
  mode: DesignSystemRequestMode;
  source: DesignSystemRequestSource;
  reason: string;
  requester?: string;
  projectId?: string;
  projectName?: string;
  kind?: ProjectMetadata['kind'] | string;
}

export function approvedDesignSystemCandidates(
  designSystems: DesignSystemSummary[],
): DesignSystemSummary[] {
  return designSystems.filter((system) => system.status === 'published');
}

export function buildDesignSystemRequestInput(
  input: DesignSystemRequestPrimitiveInput,
): DesignSystemRequestCreateRequest {
  const reason = input.reason.trim();
  return {
    source: input.source,
    requester: input.requester ?? 'local-user',
    reason,
    temporaryMode: true,
    linkedProjectId: input.projectId,
    projectContext: {
      ...(input.projectId ? { projectId: input.projectId } : {}),
      ...(input.projectName ? { projectName: input.projectName } : {}),
      ...(input.kind ? { kind: String(input.kind) } : {}),
      surface: input.mode,
    },
  };
}

export function temporaryDesignSystemMetadata(reason: string): Pick<ProjectMetadata, 'designSystemMode' | 'temporaryDesignSystem'> {
  return {
    designSystemMode: 'temporary-none',
    temporaryDesignSystem: {
      reason: reason.trim(),
      createdAt: new Date().toISOString(),
    },
  };
}
