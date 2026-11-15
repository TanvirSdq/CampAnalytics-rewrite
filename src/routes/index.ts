import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getGlobalContext } from '../core/context.js';
import { handleHealth } from './health.js';
import { handleInflux } from './influx.js';
import { handleRetention } from './retention.js';
import { handleMobility } from './mobility.js';
import { handleDiversity } from './diversity.js';
import { handleUtility } from './utility.js';
import { handleQuality } from './quality.js';
import { handleDocumentation } from './documentation.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../..');

const router = Router();

export function handleHome(req: Request, res: Response): void | Promise<void> {
  const mode = (req.query.mode as string) || 'Tools';
  if (mode === 'Retention Analytics' || mode === 'Retention') {
    return handleRetention(req, res);
  } else if (mode === 'Health Evaluation' || mode === 'Health' || mode === 'Evaluation') {
    return handleHealth(req, res);
  } else if (mode === 'New User Influx' || mode === 'Influx' || mode === 'New Users') {
    return handleInflux(req, res);
  } else if (mode === 'Mobility' || mode === 'Contributor Mobility') {
    return handleMobility(req, res);
  } else if (mode === 'Diversity' || mode === 'Contributor Diversity') {
    return handleDiversity(req, res);
  } else if (mode === 'Content Utility' || mode === 'Utility') {
    return handleUtility(req, res);
  } else if (mode === 'Quality Recognition' || mode === 'Quality') {
    return handleQuality(req, res);
  } else if (
    ['Methodology', 'Methodology & Usage', 'info', 'Info', 'Documentation', 'Info & Documentation'].includes(mode)
  ) {
    return handleDocumentation(req, res);
  }

  res.render('home.html', {
    ...getGlobalContext(req),
    PAGE_TITLE: 'CampTools',
    mode: 'Tools'
  });
}

router.get('/', handleHome);
router.get('/tools', (req: Request, res: Response) => {
  res.render('home.html', {
    ...getGlobalContext(req),
    PAGE_TITLE: 'CampTools',
    mode: 'Tools'
  });
});

// Self-hosted TopoJSON asset endpoint for zero-external-dependency Choropleth projections
router.get('/topojson/:filename', (req: Request, res: Response) => {
  const filename = String(req.params.filename || '').replace(/[^a-zA-Z0-9_.-]/g, '');
  if (!filename.endsWith('.json')) {
    res.status(400).json({ error: 'Invalid TopoJSON filename' });
    return;
  }
  const cachedFile = path.join(PROJECT_ROOT, 'data', 'topojson', filename);
  if (fs.existsSync(cachedFile)) {
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    res.type('application/json').sendFile(cachedFile);
    return;
  }
  res.status(404).json({ error: `TopoJSON asset '${filename}' not cached locally.` });
});

export default router;
