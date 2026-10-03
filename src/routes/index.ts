import { Router, Request, Response } from 'express';
import { getGlobalContext } from '../core/context.js';
import { handleHealth } from './health.js';
import { handleInflux } from './influx.js';
import { handleRetention } from './retention.js';
import { handleUtility } from './utility.js';
import { handleQuality } from './quality.js';
import { handleDocumentation } from './documentation.js';

const router = Router();

export function handleHome(req: Request, res: Response): void | Promise<void> {
  const mode = (req.query.mode as string) || 'Tools';
  if (mode === 'Retention Analytics' || mode === 'Retention') {
    return handleRetention(req, res);
  } else if (mode === 'Health Evaluation' || mode === 'Health') {
    return handleHealth(req, res);
  } else if (mode === 'New User Influx' || mode === 'Influx' || mode === 'New Users') {
    return handleInflux(req, res);
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
    PAGE_TITLE: 'CampTools — Wikimedia Campaign & Contributor Analytics',
    mode: 'Tools'
  });
}

router.get('/', handleHome);
router.get('/tools', (req: Request, res: Response) => {
  res.render('home.html', {
    ...getGlobalContext(req),
    PAGE_TITLE: 'CampTools — Wikimedia Campaign & Contributor Analytics',
    mode: 'Tools'
  });
});

export default router;
