import type { Express } from 'express';
import type { Project } from '@open-design/contracts';

import {
  ProjectDesignSystemPromotionError,
  promoteProjectToDesignSystem,
} from '../project-design-system-promotion.js';

export type RegisterProjectDesignSystemPromotionRoutesDeps = {
  paths: {
    PROJECTS_DIR: string;
    USER_DESIGN_SYSTEMS_DIR: string;
  };
  getProject: (projectId: string) => Project | null;
};

export function registerProjectDesignSystemPromotionRoutes(
  app: Express,
  ctx: RegisterProjectDesignSystemPromotionRoutesDeps,
): void {
  app.post('/api/projects/:projectId/design-system-promotions', async (req, res) => {
    try {
      const response = await promoteProjectToDesignSystem({
        projectId: req.params.projectId,
        input: req.body || {},
        projectsRoot: ctx.paths.PROJECTS_DIR,
        userDesignSystemsRoot: ctx.paths.USER_DESIGN_SYSTEMS_DIR,
        getProject: ctx.getProject,
      });
      res.status(201).json(response);
    } catch (err) {
      if (err instanceof ProjectDesignSystemPromotionError) {
        const status = err.code === 'PROJECT_NOT_FOUND' ? 404 : 400;
        return res.status(status).json({ error: err.message });
      }
      res.status(500).json({ error: String(err) });
    }
  });
}
