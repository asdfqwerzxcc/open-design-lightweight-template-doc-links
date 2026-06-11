import http from 'node:http';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve as pathResolve } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const execFileP = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const DAEMON_ROOT = pathResolve(__dirname, '..');
const REPO_ROOT = pathResolve(__dirname, '../../..');
const CLI_SRC = pathResolve(__dirname, '../src/cli.ts');
const TSX_CLI = pathResolve(REPO_ROOT, 'node_modules/tsx/dist/cli.mjs');

interface CapturedRequest {
  method: string;
  url: string;
  body: string;
}

async function startStubServer() {
  const requests: CapturedRequest[] = [];
  let responder: ((req: CapturedRequest) => { status: number; body: unknown }) | null = null;
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on('end', () => {
      const captured = {
        method: req.method ?? '',
        url: req.url ?? '',
        body: Buffer.concat(chunks).toString('utf8'),
      };
      requests.push(captured);
      const response = responder?.(captured) ?? { status: 200, body: { ok: true } };
      res.statusCode = response.status;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(response.body));
    });
  });
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('stub server has no address');
  return {
    baseUrl: `http://127.0.0.1:${addr.port}`,
    requests,
    setResponder(fn: typeof responder) {
      responder = fn;
    },
    close: () => new Promise<void>((resolveClose, rejectClose) => {
      server.close((err) => (err ? rejectClose(err) : resolveClose()));
    }),
  };
}

async function runCli(args: string[]): Promise<{ stdout: string; stderr: string; code: number | null }> {
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  try {
    const { stdout, stderr } = await execFileP(process.execPath, [TSX_CLI, CLI_SRC, ...args], {
      cwd: DAEMON_ROOT,
      env,
      timeout: 15_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    return { stdout, stderr, code: 0 };
  } catch (err) {
    const failed = err as { stdout?: string; stderr?: string; code?: number | null };
    return { stdout: failed.stdout ?? '', stderr: failed.stderr ?? '', code: failed.code ?? 1 };
  }
}

describe('od document-box CLI', () => {
  let stub: Awaited<ReturnType<typeof startStubServer>>;

  beforeAll(async () => {
    stub = await startStubServer();
  });

  afterAll(async () => {
    await stub.close();
  });

  beforeEach(() => {
    stub.requests.length = 0;
    stub.setResponder(() => ({ status: 200, body: { ok: true } }));
  });

  it('lists document-box documents as raw JSON under --json', async () => {
    const payload = { documents: [{ id: 'doc_1', title: 'Brief', fileName: 'brief.pdf' }] };
    stub.setResponder((req) => {
      if (req.method === 'GET' && req.url === '/api/document-box/documents') {
        return { status: 200, body: payload };
      }
      return { status: 404, body: { error: 'unexpected' } };
    });

    const result = await runCli(['document-box', 'list', '--json', '--daemon-url', stub.baseUrl]);

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(payload);
    expect(stub.requests[0]).toMatchObject({ method: 'GET', url: '/api/document-box/documents' });
  });

  it('uploads a document file with multipart form data', async () => {
    const tempDir = await mkdtemp('od-cli-doc-');
    const filePath = join(tempDir, 'brief.txt');
    await writeFile(filePath, 'brief', 'utf8');
    try {
      stub.setResponder((req) => {
        if (req.method === 'POST' && req.url === '/api/document-box/documents') {
          return { status: 201, body: { document: { id: 'doc_1', title: 'Brief', fileName: 'brief.txt' } } };
        }
        return { status: 404, body: { error: 'unexpected' } };
      });

      const result = await runCli([
        'document-box',
        'add',
        '--file',
        filePath,
        '--title',
        'Brief',
        '--daemon-url',
        stub.baseUrl,
      ]);

      expect(result.code).toBe(0);
      expect(stub.requests[0]?.method).toBe('POST');
      expect(stub.requests[0]?.url).toBe('/api/document-box/documents');
      expect(stub.requests[0]?.body).toContain('name="title"');
      expect(stub.requests[0]?.body).toContain('Brief');
      expect(stub.requests[0]?.body).toContain('filename="brief.txt"');
      expect(result.stdout).toContain('[document-box] added Brief (doc_1)');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('creates and revokes document links', async () => {
    stub.setResponder((req) => {
      if (req.method === 'POST' && req.url === '/api/document-box/documents/doc_1/links') {
        return { status: 201, body: { link: { id: 'link_1', tokenUrl: 'http://127.0.0.1/document-box/token' } } };
      }
      if (req.method === 'POST' && req.url === '/api/document-box/links/link_1/revoke') {
        return { status: 200, body: { ok: true } };
      }
      return { status: 404, body: { error: 'unexpected' } };
    });

    const create = await runCli([
      'document-box',
      'link',
      'create',
      'doc_1',
      '--expires-at',
      '2030-01-01T00:00:00.000Z',
      '--daemon-url',
      stub.baseUrl,
    ]);
    expect(create.code).toBe(0);
    expect(JSON.parse(stub.requests[0]?.body ?? '{}')).toEqual({ expiresAt: Date.parse('2030-01-01T00:00:00.000Z') });
    expect(create.stdout).toContain('[document-box] link http://127.0.0.1/document-box/token');

    const revoke = await runCli(['document-box', 'link', 'revoke', 'link_1', '--daemon-url', stub.baseUrl]);
    expect(revoke.code).toBe(0);
    expect(stub.requests[1]).toMatchObject({ method: 'POST', url: '/api/document-box/links/link_1/revoke' });
    expect(revoke.stdout).toContain('[document-box] revoked link_1');
  });
});
