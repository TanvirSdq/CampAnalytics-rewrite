import { Router, Request, Response } from 'express';
import { getGlobalContext } from '../core/context.js';

const router = Router();

export function handleDocumentation(req: Request, res: Response): void {
  res.render('documentation.html', {
    ...getGlobalContext(req),
    PAGE_TITLE: 'CampTools - Documentation',
    mode: 'Documentation',
    error: null
  });
}

router.get(['/documentation', '/info', '/methodology'], handleDocumentation);

export default router;
