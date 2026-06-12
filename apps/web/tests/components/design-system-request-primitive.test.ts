import { describe, expect, it } from 'vitest';

import {
  approvedDesignSystemCandidates,
  buildDesignSystemRequestInput,
  temporaryDesignSystemMetadata,
} from '../../src/components/design-system-request-primitive';
import type { DesignSystemSummary } from '../../src/types';

function system(overrides: Partial<DesignSystemSummary>): DesignSystemSummary {
  return {
    id: 'default',
    title: 'Default',
    category: 'General',
    summary: '',
    status: 'published',
    ...overrides,
  };
}

describe('design-system request primitive', () => {
  it('keeps general picker candidates approved-only', () => {
    expect(
      approvedDesignSystemCandidates([
        system({ id: 'approved', status: 'published' }),
        system({ id: 'draft', status: 'draft' }),
      ]).map((entry) => entry.id),
    ).toEqual(['approved']);
  });

  it('builds a request payload shared by home and project pickers', () => {
    expect(
      buildDesignSystemRequestInput({
        mode: 'project-single',
        source: 'project_header',
        reason: 'Need the internal admin brand.',
        projectId: 'p1',
        projectName: 'Admin Console',
        kind: 'prototype',
      }),
    ).toMatchObject({
      source: 'project_header',
      reason: 'Need the internal admin brand.',
      temporaryMode: true,
      linkedProjectId: 'p1',
      projectContext: {
        projectId: 'p1',
        projectName: 'Admin Console',
        kind: 'prototype',
        surface: 'project-single',
      },
    });
  });

  it('stamps temporary no-design-system metadata', () => {
    const metadata = temporaryDesignSystemMetadata('No approved fit yet.');

    expect(metadata.designSystemMode).toBe('temporary-none');
    expect(metadata.temporaryDesignSystem?.reason).toBe('No approved fit yet.');
    expect(metadata.temporaryDesignSystem?.createdAt).toEqual(expect.any(String));
  });
});
