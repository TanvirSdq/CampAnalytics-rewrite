import { Router, Request, Response } from 'express';

const router = Router();

export function handleHealthz(req: Request, res: Response): void {
  res.status(200).send('OK');
}

router.get('/healthz', handleHealthz);

export default router;
