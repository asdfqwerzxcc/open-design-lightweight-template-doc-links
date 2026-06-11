import path from 'node:path';
import type { Express } from 'express';

import {
  DesignSystemStaticExportError,
  exportDesignSystemStaticHtml,
} from '../design-system-static-export.js';

export type RegisterDesignSystemStaticExportRoutesDeps = {
  paths: {
    DESIGN_SYSTEMS_DIR: string;
    RUNTIME_DATA_DIR: string;
    USER_DESIGN_SYSTEMS_DIR: string;
  };
};

export function registerDesignSystemStaticExportRoutes(
  app: Express,
  ctx: RegisterDesignSystemStaticExportRoutesDeps,
): void {
  app.post('/api/design-systems/:id/exports/static-html', async (req, res) => {
    try {
      const rawOutDir = req.body?.outDir;
      if (
        rawOutDir !== undefined
        && (typeof rawOutDir !== 'string' || rawOutDir.trim().length === 0)
      ) {
        return res.status(400).json({ error: 'outDir must be a non-empty string when provided' });
      }
      const response = await exportDesignSystemStaticHtml({
        designSystemId: req.params.id,
        builtInRoot: ctx.paths.DESIGN_SYSTEMS_DIR,
        userRoot: ctx.paths.USER_DESIGN_SYSTEMS_DIR,
        outDir: rawOutDir?.trim() || path.join(ctx.paths.RUNTIME_DATA_DIR, 'exports', 'design-systems'),
        includeSourceEvidence: req.body?.includeSourceEvidence !== false,
      });
      res.json(response);
    } catch (err) {
      if (err instanceof DesignSystemStaticExportError) {
        if (err.code === 'DESIGN_SYSTEM_NOT_FOUND') {
          return res.status(404).json({ error: err.message });
        }
        return res.status(400).json({ error: `invalid output path: ${err.message}` });
      }
      res.status(500).json({ error: String(err) });
    }
  });
}
