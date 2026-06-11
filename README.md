# Open Design Lightweight

Open Design Lightweight is a local-first fork focused on one practical workflow:
turn user-authored HTML into reusable Open Design project templates, then create
new projects from those templates.

This fork intentionally keeps the product surface small. It is meant for local
template work, not for upstream community growth, cloud publishing, or broad
marketing pages.

## What This Fork Adds

- Import HTML from a file or pasted source.
- Save imported HTML as a reusable project template.
- Derive lightweight design-system metadata from the imported HTML:
  `DESIGN.md`, `tokens.css`, `components.html`, and a manifest.
- Create a new Open Design project from a saved template.
- Optionally register local documents in Document Box and create revocable local
  links for those files.

## What Is Intentionally Out Of Scope

- No cloud deploy or public hosting.
- No account system or external auth provider.
- No upstream Discord, GitHub-star, or community growth prompts in the main
  documentation.
- No LAN tunneling or remote sync.
- No direct raw HTML serving as a privileged app page; imported HTML is used
  through the existing project preview surface.

## Quick Start

Use Node `~24` and `pnpm@10.33.2`.

```bash
pnpm install
pnpm tools-dev start web
```

Open:

```text
http://127.0.0.1:17573
```

If you need explicit ports:

```bash
pnpm tools-dev run web --daemon-port 17456 --web-port 17573
```

## HTML Template Workflow

### Web UI

1. Open the local web app.
2. Open the new project flow.
3. Choose the template/import area.
4. Paste HTML or select a `.html` / `.htm` file.
5. Import it as a template.
6. Create a project from that template.

### CLI

Import an HTML file:

```bash
od templates import-html --input ./landing.html --name "Landing Template"
```

Import HTML from stdin:

```bash
cat ./landing.html | od templates import-html --input - --name "Landing Template"
```

Create a project from a saved template:

```bash
od templates create-project <templateId> --name "Landing Project"
```

Use `--json` on CLI commands when another script or agent needs structured
output.

## Document Box

Document Box is optional. Keep it if you want local, unlisted links for files
that live with the daemon data. Remove it if your fork only needs HTML template
reuse.

Supported file types:

```text
.pdf .docx .pptx .xlsx .txt .md .html .png .jpg .jpeg .webp .svg
```

CLI:

```bash
od document-box list
od document-box add --file ./brief.pdf --title "Brief"
od document-box link create <documentId>
od document-box link create <documentId> --expires-at 2026-12-31T23:59:59Z
od document-box link revoke <linkId>
```

Links are local daemon links. Raw tokens are not stored; token hashes are stored
instead. Revoked or unknown links return `404`, and expired links return `410`.

## Main API Surface

Templates:

```text
GET    /api/templates
GET    /api/templates/:id
POST   /api/templates
DELETE /api/templates/:id
POST   /api/templates/import-html
POST   /api/templates/:id/create-project
```

Document Box:

```text
GET    /api/document-box/documents
POST   /api/document-box/documents
DELETE /api/document-box/documents/:documentId
GET    /api/document-box/documents/:documentId/links
POST   /api/document-box/documents/:documentId/links
POST   /api/document-box/links/:linkId/revoke
GET    /document-box/:token
```

## Development Commands

```bash
pnpm guard
pnpm typecheck
pnpm --filter @open-design/contracts test
pnpm --filter @open-design/daemon test
pnpm --filter @open-design/web test
```

Use package-scoped commands for focused work. The root scripts are reserved for
repo-level checks and the `tools-dev` control plane.

## Runtime Data

Local runtime data is written under `.od/` by default. Development process data
is written under `.tmp/`. Both are ignored.

Document Box files are stored under:

```text
.od/document-box/
```

## Notes For This Fork

- Keep the README focused on the lightweight workflow.
- Treat Document Box as optional unless document links are part of the user's
  actual workflow.
- Keep UI and CLI parity for user-facing features.
- Keep shared request/response shapes in `packages/contracts`.
