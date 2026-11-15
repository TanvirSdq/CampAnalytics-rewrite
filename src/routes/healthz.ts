import { Router, Request, Response } from 'express';
import { getAnalyticsCacheTelemetry } from '../core/analytics.js';
import { getSnapshotStatus } from '../core/snapshotStore.js';

const router = Router();

export function handleHealthz(req: Request, res: Response): void {
  if (req.query.format === 'json') {
    handleHealthzApi(req, res);
    return;
  }
  res.status(200).send('OK');
}

export function handleHealthzApi(_req: Request, res: Response): void {
  const mem = process.memoryUsage();
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime_sec: Math.round(process.uptime()),
    memory_mb: {
      rss: parseFloat((mem.rss / (1024 * 1024)).toFixed(1)),
      heap_used: parseFloat((mem.heapUsed / (1024 * 1024)).toFixed(1)),
      heap_total: parseFloat((mem.heapTotal / (1024 * 1024)).toFixed(1))
    },
    cache: getAnalyticsCacheTelemetry(),
    daily_snapshot: getSnapshotStatus()
  });
}

router.get('/healthz', handleHealthz);
router.get('/api/healthz', handleHealthzApi);

export default router;
