import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type {
  DesignSystemReadinessGate,
  DesignSystemReadinessGateId,
  DesignSystemReadinessGateStatus,
  DesignSystemReadinessState,
  DesignSystemRequestCreateRequest,
  DesignSystemRequestItem,
  DesignSystemRequestStatus,
  DesignSystemRequestUpdateRequest,
  DesignSystemSummary,
} from '@open-design/contracts';

const REQUESTS_SCHEMA_VERSION = 'design-system-requests/v1';
const APPROVAL_SCHEMA_VERSION = 'design-system-approval/v1';

const REQUEST_STATUSES: readonly DesignSystemRequestStatus[] = [
  'open',
  'triaging',
  'planned',
  'in_progress',
  'fulfilled',
  'rejected',
  'closed',
] as const;

const REVIEW_GATE_IDS: readonly DesignSystemReadinessGateId[] = [
  'review:designops',
  'review:brand-fit',
  'review:token-completeness',
  'review:component-completeness',
  'review:accessibility-baseline',
] as const;

const GATE_LABELS: Record<DesignSystemReadinessGateId, string> = {
  'artifact:design-md': 'DESIGN.md',
  'artifact:tokens-css': 'Tokens CSS',
  'artifact:components-or-preview': 'Components or preview',
  'artifact:quality-report': 'Quality report',
  'review:designops': 'DesignOps review',
  'review:brand-fit': 'Brand fit',
  'review:token-completeness': 'Token completeness',
  'review:component-completeness': 'Component completeness',
  'review:accessibility-baseline': 'Accessibility baseline',
};

const REQUIRED_GATE_IDS = new Set<DesignSystemReadinessGateId>([
  'artifact:design-md',
  'artifact:tokens-css',
  'artifact:components-or-preview',
  'artifact:quality-report',
  ...REVIEW_GATE_IDS,
]);

interface RequestStore {
  schemaVersion: typeof REQUESTS_SCHEMA_VERSION;
  requests: DesignSystemRequestItem[];
}

interface PersistedReadinessStore {
  schemaVersion: typeof APPROVAL_SCHEMA_VERSION;
  systems: Record<string, PersistedReadiness>;
}

interface PersistedReadiness {
  gates?: DesignSystemReadinessGate[];
  approvedAt?: string;
  approvedBy?: string;
  publishedAt?: string;
  publishedBy?: string;
  evaluatedAt?: string;
  evaluatedBy?: string;
}

export class DesignSystemGovernanceError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function isDesignSystemRequestStatus(value: unknown): value is DesignSystemRequestStatus {
  return typeof value === 'string' && REQUEST_STATUSES.includes(value as DesignSystemRequestStatus);
}

export function isDesignSystemReadinessGateStatus(value: unknown): value is DesignSystemReadinessGateStatus {
  return value === 'missing' || value === 'pending' || value === 'passed' || value === 'failed' || value === 'waived';
}

export function isDesignSystemReadinessGateId(value: unknown): value is DesignSystemReadinessGateId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(GATE_LABELS, value);
}

export async function listDesignSystemRequests(
  runtimeDataDir: string,
  options: { status?: DesignSystemRequestStatus } = {},
): Promise<DesignSystemRequestItem[]> {
  const store = await readRequestStore(runtimeDataDir);
  const requests = options.status
    ? store.requests.filter((request) => request.status === options.status)
    : store.requests;
  return requests.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getDesignSystemRequest(
  runtimeDataDir: string,
  id: string,
): Promise<DesignSystemRequestItem | null> {
  const store = await readRequestStore(runtimeDataDir);
  return store.requests.find((request) => request.id === id) ?? null;
}

export async function createDesignSystemRequest(
  runtimeDataDir: string,
  input: DesignSystemRequestCreateRequest,
  options: { linkedProjectId?: string | null; now?: string; actor?: string | null } = {},
): Promise<DesignSystemRequestItem> {
  const reason = cleanRequiredString(input.reason, 'reason', 2000);
  const now = options.now ?? new Date().toISOString();
  const source = normalizeRequestSource(input.source);
  const requester = cleanOptionalString(input.requester, 160) ?? options.actor ?? 'local-user';
  const linkedProjectId = cleanOptionalString(input.linkedProjectId, 160)
    ?? cleanOptionalString(options.linkedProjectId, 160)
    ?? null;
  const projectContext = normalizeProjectContext(input.projectContext);
  const request: DesignSystemRequestItem = {
    id: `dsr_${randomUUID()}`,
    status: 'open',
    source,
    requester,
    reason,
    ...(projectContext ? { projectContext } : {}),
    linkedProjectId,
    temporaryMode: input.temporaryMode === true,
    resolvedDesignSystemId: null,
    resolutionNote: null,
    createdAt: now,
    updatedAt: now,
    statusUpdatedAt: now,
    statusUpdatedBy: requester,
  };
  const store = await readRequestStore(runtimeDataDir);
  store.requests.push(request);
  await writeRequestStore(runtimeDataDir, store);
  return request;
}

export async function deleteDesignSystemRequest(
  runtimeDataDir: string,
  id: string,
): Promise<boolean> {
  const store = await readRequestStore(runtimeDataDir);
  const next = store.requests.filter((request) => request.id !== id);
  if (next.length === store.requests.length) return false;
  await writeRequestStore(runtimeDataDir, { ...store, requests: next });
  return true;
}

export async function updateDesignSystemRequest(
  runtimeDataDir: string,
  id: string,
  input: DesignSystemRequestUpdateRequest,
): Promise<DesignSystemRequestItem | null> {
  const store = await readRequestStore(runtimeDataDir);
  const index = store.requests.findIndex((request) => request.id === id);
  if (index < 0) return null;
  const current = store.requests[index]!;
  const now = new Date().toISOString();
  const nextStatus = input.status === undefined ? current.status : input.status;
  if (!isDesignSystemRequestStatus(nextStatus)) {
    throw new DesignSystemGovernanceError(400, 'DESIGN_SYSTEM_REQUEST_INVALID_STATUS', `invalid request status: ${String(input.status)}`);
  }
  const actor = cleanOptionalString(input.statusUpdatedBy, 160) ?? 'local-user';
  const updated: DesignSystemRequestItem = {
    ...current,
    status: nextStatus,
    resolvedDesignSystemId: cleanOptionalString(input.resolvedDesignSystemId, 160) ?? current.resolvedDesignSystemId ?? null,
    resolutionNote: input.resolutionNote === null
      ? null
      : cleanOptionalString(input.resolutionNote, 2000) ?? current.resolutionNote ?? null,
    updatedAt: now,
    statusUpdatedAt: nextStatus === current.status ? current.statusUpdatedAt : now,
    statusUpdatedBy: nextStatus === current.status ? current.statusUpdatedBy ?? null : actor,
  };
  store.requests[index] = updated;
  await writeRequestStore(runtimeDataDir, store);
  return updated;
}

export function designSystemRequestProjectMetadata(request: DesignSystemRequestItem) {
  return {
    id: request.id,
    status: request.status,
    reason: request.reason,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
  };
}

export async function readDesignSystemReadiness(
  runtimeDataDir: string,
  designSystemsRoot: string,
  userDesignSystemsRoot: string,
  summary: DesignSystemSummary,
): Promise<DesignSystemReadinessState> {
  const persisted = (await readReadinessStore(runtimeDataDir)).systems[summary.id] ?? {};
  const now = new Date().toISOString();
  const artifactGates = await buildArtifactGates(designSystemsRoot, userDesignSystemsRoot, summary, persisted, now);
  const reviewGates = buildReviewGates(summary, persisted, now);
  const gates = mergeGateLists([...artifactGates, ...reviewGates]);
  const blockers = gates
    .filter((gate) => gate.required && gate.status !== 'passed' && gate.status !== 'waived')
    .map((gate) => `${gate.label}: ${gate.message ?? gate.status}`);
  const readyToPublish = blockers.length === 0;
  const approved = summary.status === 'published' && readyToPublish;
  const state: DesignSystemReadinessState = {
    schemaVersion: APPROVAL_SCHEMA_VERSION,
    designSystemId: summary.id,
    readyToPublish,
    approved,
    gates,
    blockers,
    evaluatedAt: persisted.evaluatedAt ?? now,
    evaluatedBy: persisted.evaluatedBy ?? 'system',
    ...(approved ? { approvedAt: persisted.approvedAt ?? summary.updatedAt ?? summary.createdAt ?? now } : {}),
    ...(approved ? { approvedBy: persisted.approvedBy ?? 'system' } : {}),
    ...(summary.status === 'published' ? { publishedAt: persisted.publishedAt ?? summary.updatedAt ?? summary.createdAt ?? now } : {}),
    ...(summary.status === 'published' ? { publishedBy: persisted.publishedBy ?? 'system' } : {}),
  };
  return state;
}

export async function updateDesignSystemReadiness(
  runtimeDataDir: string,
  designSystemId: string,
  input: {
    gateId?: unknown;
    status?: unknown;
    message?: unknown;
    evidencePath?: unknown;
    waivedBy?: unknown;
    waiverReason?: unknown;
    actor?: unknown;
  },
): Promise<PersistedReadiness> {
  const gateId = input.gateId;
  if (!isDesignSystemReadinessGateId(gateId)) {
    throw new DesignSystemGovernanceError(400, 'DESIGN_SYSTEM_READINESS_INVALID_GATE', 'invalid readiness gate id');
  }
  if (!isDesignSystemReadinessGateStatus(input.status)) {
    throw new DesignSystemGovernanceError(400, 'DESIGN_SYSTEM_READINESS_INVALID_STATUS', 'invalid readiness gate status');
  }
  const store = await readReadinessStore(runtimeDataDir);
  const current = store.systems[designSystemId] ?? {};
  const now = new Date().toISOString();
  const actor = cleanOptionalString(input.actor, 160) ?? 'local-user';
  const currentGates = mergeGateLists(current.gates ?? []);
  const evidencePath = cleanOptionalString(input.evidencePath, 500);
  const nextGate: DesignSystemReadinessGate = {
    ...(currentGates.find((gate) => gate.id === gateId) ?? defaultGate(gateId, true, 'pending', 'Awaiting review.')),
    id: gateId,
    label: GATE_LABELS[gateId],
    required: REQUIRED_GATE_IDS.has(gateId),
    status: input.status,
    message: cleanOptionalString(input.message, 500) ?? statusMessage(input.status),
    ...(evidencePath ? { evidencePath } : {}),
    checkedAt: now,
    checkedBy: actor,
    ...(input.status === 'waived' ? { waivedAt: now } : {}),
    ...(input.status === 'waived' ? { waivedBy: cleanOptionalString(input.waivedBy, 160) ?? actor } : {}),
    ...(input.status === 'waived' ? { waiverReason: cleanOptionalString(input.waiverReason, 500) ?? 'Waived by DesignOps.' } : {}),
  };
  const next: PersistedReadiness = {
    ...current,
    gates: mergeGateLists([...currentGates.filter((gate) => gate.id !== gateId), nextGate]),
    evaluatedAt: now,
    evaluatedBy: actor,
  };
  store.systems[designSystemId] = next;
  await writeReadinessStore(runtimeDataDir, store);
  return next;
}

export async function filterApprovedDesignSystems(
  runtimeDataDir: string,
  designSystemsRoot: string,
  userDesignSystemsRoot: string,
  systems: DesignSystemSummary[],
): Promise<DesignSystemSummary[]> {
  const entries = await Promise.all(
    systems.map(async (system) => ({
      system,
      readiness: await readDesignSystemReadiness(runtimeDataDir, designSystemsRoot, userDesignSystemsRoot, system),
    })),
  );
  return entries
    .filter(({ readiness }) => readiness.approved)
    .map(({ system }) => system);
}

export async function assertDesignSystemReadyToPublish(
  runtimeDataDir: string,
  designSystemsRoot: string,
  userDesignSystemsRoot: string,
  summary: DesignSystemSummary,
): Promise<void> {
  const readiness = await readDesignSystemReadiness(runtimeDataDir, designSystemsRoot, userDesignSystemsRoot, summary);
  if (!readiness.readyToPublish) {
    throw new DesignSystemGovernanceError(
      400,
      'DESIGN_SYSTEM_PUBLISH_BLOCKED',
      `Design system is not ready to publish: ${readiness.blockers.join('; ')}`,
    );
  }
}

async function readRequestStore(runtimeDataDir: string): Promise<RequestStore> {
  const file = requestStorePath(runtimeDataDir);
  try {
    const raw = JSON.parse(await readFile(file, 'utf8')) as Partial<RequestStore>;
    return {
      schemaVersion: REQUESTS_SCHEMA_VERSION,
      requests: Array.isArray(raw.requests) ? raw.requests.filter(isRequestItem) : [],
    };
  } catch (err) {
    if (isAbsenceError(err)) return { schemaVersion: REQUESTS_SCHEMA_VERSION, requests: [] };
    throw err;
  }
}

async function writeRequestStore(runtimeDataDir: string, store: RequestStore): Promise<void> {
  await writeJsonAtomic(requestStorePath(runtimeDataDir), {
    schemaVersion: REQUESTS_SCHEMA_VERSION,
    requests: store.requests,
  });
}

async function readReadinessStore(runtimeDataDir: string): Promise<PersistedReadinessStore> {
  const file = readinessStorePath(runtimeDataDir);
  try {
    const raw = JSON.parse(await readFile(file, 'utf8')) as Partial<PersistedReadinessStore>;
    return {
      schemaVersion: APPROVAL_SCHEMA_VERSION,
      systems: raw.systems && typeof raw.systems === 'object' && !Array.isArray(raw.systems)
        ? raw.systems as Record<string, PersistedReadiness>
        : {},
    };
  } catch (err) {
    if (isAbsenceError(err)) return { schemaVersion: APPROVAL_SCHEMA_VERSION, systems: {} };
    throw err;
  }
}

async function writeReadinessStore(runtimeDataDir: string, store: PersistedReadinessStore): Promise<void> {
  await writeJsonAtomic(readinessStorePath(runtimeDataDir), {
    schemaVersion: APPROVAL_SCHEMA_VERSION,
    systems: store.systems,
  });
}

function requestStorePath(runtimeDataDir: string): string {
  return path.join(runtimeDataDir, 'design-system-requests.json');
}

function readinessStorePath(runtimeDataDir: string): string {
  return path.join(runtimeDataDir, 'design-system-approval.json');
}

async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(tmp, file);
}

async function buildArtifactGates(
  designSystemsRoot: string,
  userDesignSystemsRoot: string,
  summary: DesignSystemSummary,
  persisted: PersistedReadiness,
  now: string,
): Promise<DesignSystemReadinessGate[]> {
  if (summary.source !== 'user' && summary.isEditable !== true) {
    return [
      passedGate('artifact:design-md', 'Bundled design system ships DESIGN.md.', now),
      passedGate('artifact:tokens-css', 'Bundled design system ships token guidance.', now),
      passedGate('artifact:components-or-preview', 'Bundled design system ships previews.', now),
      passedGate('artifact:quality-report', 'Bundled design system is treated as approved first-party content.', now),
    ];
  }
  const dir = path.join(userDesignSystemsRoot, stripUserPrefix(summary.id));
  const hasDesign = await fileExists(path.join(dir, 'DESIGN.md')) || await fileExists(path.join(designSystemsRoot, stripUserPrefix(summary.id), 'DESIGN.md'));
  const hasTokens = await anyFileExists(dir, ['tokens.css', 'colors_and_type.css', 'source/tokens.css', 'source/token-contract.report.json']);
  const hasComponents = await anyFileExists(dir, ['components', 'preview', 'ui_kits/app/index.html', 'index.html']);
  const hasQuality = await anyFileExists(dir, ['quality-report.md', 'quality-report.json', 'source/token-contract.report.json', 'context/provenance.json']);
  const legacyPublished = summary.status === 'published' && !persisted.gates?.length;
  return [
    gateFromPresence('artifact:design-md', hasDesign || legacyPublished, 'DESIGN.md is required.', now),
    gateFromPresence('artifact:tokens-css', hasTokens || legacyPublished, 'Tokens CSS or token contract evidence is required.', now),
    gateFromPresence('artifact:components-or-preview', hasComponents || legacyPublished, 'Components or preview output is required.', now),
    gateFromPresence('artifact:quality-report', hasQuality || legacyPublished, 'Quality report or provenance evidence is required.', now),
  ];
}

function buildReviewGates(
  summary: DesignSystemSummary,
  persisted: PersistedReadiness,
  now: string,
): DesignSystemReadinessGate[] {
  const persistedById = new Map((persisted.gates ?? []).map((gate) => [gate.id, gate]));
  const legacyPublished = summary.status === 'published' && !persisted.gates?.length;
  return REVIEW_GATE_IDS.map((id) => {
    const persistedGate = persistedById.get(id);
    if (persistedGate) return normalizeGate(persistedGate);
    return legacyPublished
      ? passedGate(id, 'Legacy published system is migrated as reviewed.', now)
      : defaultGate(id, true, 'pending', 'Awaiting DesignOps review.');
  });
}

function mergeGateLists(gates: DesignSystemReadinessGate[]): DesignSystemReadinessGate[] {
  const byId = new Map<DesignSystemReadinessGateId, DesignSystemReadinessGate>();
  for (const gate of gates) byId.set(gate.id, normalizeGate(gate));
  return (Object.keys(GATE_LABELS) as DesignSystemReadinessGateId[])
    .map((id) => byId.get(id) ?? defaultGate(id, REQUIRED_GATE_IDS.has(id), 'pending', 'Awaiting review.'));
}

function normalizeGate(gate: DesignSystemReadinessGate): DesignSystemReadinessGate {
  return {
    ...gate,
    label: gate.label || GATE_LABELS[gate.id],
    required: gate.required ?? REQUIRED_GATE_IDS.has(gate.id),
    status: isDesignSystemReadinessGateStatus(gate.status) ? gate.status : 'pending',
  };
}

function defaultGate(
  id: DesignSystemReadinessGateId,
  required: boolean,
  status: DesignSystemReadinessGateStatus,
  message: string,
): DesignSystemReadinessGate {
  return { id, label: GATE_LABELS[id], required, status, message };
}

function passedGate(id: DesignSystemReadinessGateId, message: string, now: string): DesignSystemReadinessGate {
  return {
    id,
    label: GATE_LABELS[id],
    required: REQUIRED_GATE_IDS.has(id),
    status: 'passed',
    message,
    checkedAt: now,
    checkedBy: 'system',
  };
}

function gateFromPresence(id: DesignSystemReadinessGateId, present: boolean, missingMessage: string, now: string): DesignSystemReadinessGate {
  return present
    ? passedGate(id, 'Required artifact is present.', now)
    : defaultGate(id, true, 'missing', missingMessage);
}

async function anyFileExists(base: string, relpaths: string[]): Promise<boolean> {
  for (const relpath of relpaths) {
    if (await fileExists(path.join(base, relpath))) return true;
  }
  return false;
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

function normalizeRequestSource(source: unknown): DesignSystemRequestItem['source'] {
  return source === 'home_new_project' || source === 'project_header' || source === 'cli'
    ? source
    : 'cli';
}

function normalizeProjectContext(raw: unknown): DesignSystemRequestItem['projectContext'] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const value = raw as Record<string, unknown>;
  const out: NonNullable<DesignSystemRequestItem['projectContext']> = {};
  const projectId = cleanOptionalString(value.projectId, 160);
  const projectName = cleanOptionalString(value.projectName, 240);
  const kind = cleanOptionalString(value.kind, 80);
  const surface = cleanOptionalString(value.surface, 80);
  const description = cleanOptionalString(value.description, 1000);
  if (projectId) out.projectId = projectId;
  if (projectName) out.projectName = projectName;
  if (kind) out.kind = kind;
  if (surface) out.surface = surface;
  if (description) out.description = description;
  return Object.keys(out).length > 0 ? out : undefined;
}

function cleanRequiredString(value: unknown, field: string, max: number): string {
  const cleaned = cleanOptionalString(value, max);
  if (!cleaned) {
    throw new DesignSystemGovernanceError(400, 'DESIGN_SYSTEM_REQUEST_VALIDATION_FAILED', `${field} is required`);
  }
  return cleaned;
}

function cleanOptionalString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.trim();
  if (!cleaned) return null;
  return cleaned.slice(0, max);
}

function isRequestItem(value: unknown): value is DesignSystemRequestItem {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Partial<DesignSystemRequestItem>;
  return typeof item.id === 'string'
    && isDesignSystemRequestStatus(item.status)
    && typeof item.reason === 'string'
    && typeof item.createdAt === 'string'
    && typeof item.updatedAt === 'string';
}

function statusMessage(status: DesignSystemReadinessGateStatus): string {
  switch (status) {
    case 'missing': return 'Required evidence is missing.';
    case 'pending': return 'Awaiting review.';
    case 'passed': return 'Gate passed.';
    case 'failed': return 'Gate failed.';
    case 'waived': return 'Gate waived.';
  }
}

function stripUserPrefix(id: string): string {
  return id.startsWith('user:') ? id.slice('user:'.length) : id;
}

function isAbsenceError(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && 'code' in err && (err as { code?: string }).code === 'ENOENT');
}
