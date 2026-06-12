import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import type { DesignSystemReadinessGateId, DesignSystemSummary } from '@open-design/contracts';
import {
  DesignSystemGovernanceError,
  assertDesignSystemReadyToPublish,
  createDesignSystemRequest,
  filterApprovedDesignSystems,
  listDesignSystemRequests,
  readDesignSystemReadiness,
  updateDesignSystemReadiness,
  updateDesignSystemRequest,
} from '../src/design-system-governance.js';

const REVIEW_GATE_IDS: DesignSystemReadinessGateId[] = [
  'review:designops',
  'review:brand-fit',
  'review:token-completeness',
  'review:component-completeness',
  'review:accessibility-baseline',
];

function summary(overrides: Partial<DesignSystemSummary>): DesignSystemSummary {
  return {
    id: 'user:internal-brand',
    title: 'Internal Brand',
    category: 'Brand',
    summary: 'Internal product design system.',
    source: 'user',
    status: 'draft',
    isEditable: true,
    ...overrides,
  };
}

async function tempHarness() {
  const root = await mkdtemp(path.join(tmpdir(), 'od-ds-governance-'));
  return {
    runtimeDataDir: path.join(root, 'runtime'),
    designSystemsRoot: path.join(root, 'bundled'),
    userDesignSystemsRoot: path.join(root, 'user'),
  };
}

async function writeCompleteUserArtifacts(userDesignSystemsRoot: string, id = 'internal-brand') {
  const dir = path.join(userDesignSystemsRoot, id);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'DESIGN.md'), '# Internal Brand\n', 'utf8');
  await writeFile(path.join(dir, 'tokens.css'), ':root { --brand: #123456; }\n', 'utf8');
  await writeFile(path.join(dir, 'index.html'), '<!doctype html><main>Preview</main>\n', 'utf8');
  await writeFile(path.join(dir, 'quality-report.md'), '# Quality\n', 'utf8');
}

describe('design system governance stores', () => {
  it('persists request backlog records with project links and status updates', async () => {
    const { runtimeDataDir } = await tempHarness();

    const request = await createDesignSystemRequest(
      runtimeDataDir,
      {
        source: 'home_new_project',
        reason: ' Need a design system for internal admin tools. ',
        temporaryMode: true,
        projectContext: { projectName: 'Admin Console', kind: 'prototype' },
      },
      { linkedProjectId: 'project-1', now: '2026-06-12T00:00:00.000Z', actor: 'test' },
    );

    expect(request).toMatchObject({
      status: 'open',
      source: 'home_new_project',
      reason: 'Need a design system for internal admin tools.',
      linkedProjectId: 'project-1',
      temporaryMode: true,
      requester: 'test',
    });

    await expect(listDesignSystemRequests(runtimeDataDir, { status: 'open' })).resolves.toHaveLength(1);

    const updated = await updateDesignSystemRequest(runtimeDataDir, request.id, {
      status: 'planned',
      statusUpdatedBy: 'designops',
      resolvedDesignSystemId: 'user:internal-brand',
      resolutionNote: 'Covered by the internal brand refresh.',
    });

    expect(updated).toMatchObject({
      id: request.id,
      status: 'planned',
      statusUpdatedBy: 'designops',
      resolvedDesignSystemId: 'user:internal-brand',
      resolutionNote: 'Covered by the internal brand refresh.',
    });
    await expect(listDesignSystemRequests(runtimeDataDir, { status: 'open' })).resolves.toHaveLength(0);
    await expect(listDesignSystemRequests(runtimeDataDir, { status: 'planned' })).resolves.toHaveLength(1);
  });

  it('blocks publishing until artifact and review gates pass or waive', async () => {
    const harness = await tempHarness();
    const system = summary({ id: 'user:internal-brand', status: 'draft' });

    const emptyReadiness = await readDesignSystemReadiness(
      harness.runtimeDataDir,
      harness.designSystemsRoot,
      harness.userDesignSystemsRoot,
      system,
    );
    expect(emptyReadiness.readyToPublish).toBe(false);
    expect(emptyReadiness.blockers).toEqual(expect.arrayContaining([expect.stringContaining('DESIGN.md')]));
    await expect(
      assertDesignSystemReadyToPublish(
        harness.runtimeDataDir,
        harness.designSystemsRoot,
        harness.userDesignSystemsRoot,
        system,
      ),
    ).rejects.toMatchObject({ code: 'DESIGN_SYSTEM_PUBLISH_BLOCKED' });

    await writeCompleteUserArtifacts(harness.userDesignSystemsRoot);
    for (const gateId of REVIEW_GATE_IDS) {
      await updateDesignSystemReadiness(harness.runtimeDataDir, system.id, {
        gateId,
        status: gateId === 'review:accessibility-baseline' ? 'waived' : 'passed',
        actor: 'designops',
        waiverReason: 'Accessibility audit tracked separately for this import.',
      });
    }

    const ready = await readDesignSystemReadiness(
      harness.runtimeDataDir,
      harness.designSystemsRoot,
      harness.userDesignSystemsRoot,
      system,
    );
    expect(ready.readyToPublish).toBe(true);
    expect(ready.blockers).toEqual([]);
    await expect(
      assertDesignSystemReadyToPublish(
        harness.runtimeDataDir,
        harness.designSystemsRoot,
        harness.userDesignSystemsRoot,
        system,
      ),
    ).resolves.toBeUndefined();
  });

  it('filters the general catalog to published systems with passing readiness', async () => {
    const harness = await tempHarness();
    await writeCompleteUserArtifacts(harness.userDesignSystemsRoot);
    for (const gateId of REVIEW_GATE_IDS) {
      await updateDesignSystemReadiness(harness.runtimeDataDir, 'user:internal-brand', {
        gateId,
        status: 'passed',
        actor: 'designops',
      });
    }

    const approvedUser = summary({ id: 'user:internal-brand', status: 'published' });
    const draftUser = summary({ id: 'user:draft-brand', status: 'draft' });
    const bundled = summary({ id: 'default', source: 'built-in', status: 'published', isEditable: false });

    const visible = await filterApprovedDesignSystems(
      harness.runtimeDataDir,
      harness.designSystemsRoot,
      harness.userDesignSystemsRoot,
      [approvedUser, draftUser, bundled],
    );

    expect(visible.map((system) => system.id)).toEqual(['user:internal-brand', 'default']);
  });

  it('surfaces structured validation errors for invalid request status', async () => {
    const { runtimeDataDir } = await tempHarness();
    const request = await createDesignSystemRequest(runtimeDataDir, {
      source: 'cli',
      reason: 'Need coverage.',
    });

    await expect(
      updateDesignSystemRequest(runtimeDataDir, request.id, { status: 'unknown' as never }),
    ).rejects.toBeInstanceOf(DesignSystemGovernanceError);
    await expect(
      updateDesignSystemRequest(runtimeDataDir, request.id, { status: 'unknown' as never }),
    ).rejects.toMatchObject({ code: 'DESIGN_SYSTEM_REQUEST_INVALID_STATUS', status: 400 });
  });
});
