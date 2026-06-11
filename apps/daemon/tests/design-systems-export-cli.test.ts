import http from 'node:http';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as pathResolve } from 'node:path';
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

interface StubResponse {
  status: number;
  body: unknown;
}

interface StubServer {
  baseUrl: string;
  requests: CapturedRequest[];
  setResponder: (fn: (req: CapturedRequest) => StubResponse) => void;
  close: () => Promise<void>;
}

async function startStubServer(): Promise<StubServer> {
  const requests: CapturedRequest[] = [];
  let responder: ((req: CapturedRequest) => StubResponse) | null = null;
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on('end', () => {
      const captured: CapturedRequest = {
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
    setResponder(fn) {
      responder = fn;
    },
    close: () =>
      new Promise<void>((resolveClose, rejectClose) => {
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
  } catch (err: unknown) {
    const failed = err as { stdout?: string; stderr?: string; code?: number | null };
    return { stdout: failed.stdout ?? '', stderr: failed.stderr ?? '', code: failed.code ?? 1 };
  }
}

describe('od design-systems export-static CLI', () => {
  let stub: StubServer;

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

  it('posts to the static export API and prints raw JSON under --json', async () => {
    const payload = {
      export: {
        designSystemId: 'user:acme',
        folder: '/tmp/out/acme-static-html',
        entryFile: '/tmp/out/acme-static-html/index.html',
        files: ['index.html'],
        warnings: [],
      },
    };
    stub.setResponder((req) => {
      expect(req.method).toBe('POST');
      expect(req.url).toBe('/api/design-systems/user%3Aacme/exports/static-html');
      expect(JSON.parse(req.body)).toEqual({ outDir: '/tmp/out' });
      return { status: 200, body: payload };
    });

    const result = await runCli([
      'design-systems',
      'export-static',
      'user:acme',
      '--out',
      '/tmp/out',
      '--json',
      '--daemon-url',
      stub.baseUrl,
    ]);

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(payload);
  });

  it('prints the export folder and entry file for human output', async () => {
    stub.setResponder(() => ({
      status: 200,
      body: {
        export: {
          designSystemId: 'builtin',
          folder: '/tmp/out/builtin-static-html',
          entryFile: '/tmp/out/builtin-static-html/index.html',
          files: ['index.html'],
          warnings: ['skipped unsafe asset'],
        },
      },
    }));

    const result = await runCli([
      'design-systems',
      'export-static',
      'builtin',
      '--daemon-url',
      stub.baseUrl,
    ]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Exported builtin');
    expect(result.stdout).toContain('Folder: /tmp/out/builtin-static-html');
    expect(result.stdout).toContain('Entry: /tmp/out/builtin-static-html/index.html');
    expect(result.stderr).toContain('WARN: skipped unsafe asset');
  });

  it('surfaces non-2xx responses through structured HTTP failure output', async () => {
    stub.setResponder(() => ({
      status: 400,
      body: { error: { code: 'INVALID_OUTPUT_PATH', message: 'invalid output path' } },
    }));

    const result = await runCli([
      'design-systems',
      'export-static',
      'user:acme',
      '--out',
      '/tmp/not-dir',
      '--daemon-url',
      stub.baseUrl,
    ]);

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('invalid output path');
    expect(stub.requests[0]).toMatchObject({
      method: 'POST',
      url: '/api/design-systems/user%3Aacme/exports/static-html',
    });
  });
});
