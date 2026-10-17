import { Router, Request, Response } from 'express';
import { computeComparativeAnalytics } from '../core/analytics.js';
import { parseCountryList } from '../core/utils.js';

const router = Router();

export async function handleComparativeApi(req: Request, res: Response): Promise<void> {
  const moduleParam = ((req.query.module || 'influx') as string).trim().toLowerCase();
  if (!['influx', 'retention', 'quality', 'utility', 'diversity', 'mobility'].includes(moduleParam)) {
    res.status(400).json({
      error: `Invalid module '${moduleParam}'. Supported modules: influx, retention, quality, utility, diversity, mobility.`
    });
    return;
  }

  const eventType = ((req.query.event_type || req.query.eventType) as string || 'wlm').trim().toLowerCase();
  const rawCountries = req.query.countries || req.query.country_codes || req.query.countryCodes;
  const countryCodes = parseCountryList(rawCountries);

  const yrStart = parseInt((req.query.start_year || req.query.startYear || req.query.yr_start) as string, 10);
  const yrEnd = parseInt((req.query.end_year || req.query.endYear || req.query.yr_end) as string, 10);
  const metricKey = ((req.query.metric || req.query.metric_key || req.query.metricKey) as string || '').trim();

  try {
    const result = await computeComparativeAnalytics({
      module: moduleParam as 'influx' | 'retention' | 'quality' | 'utility' | 'diversity' | 'mobility',
      eventType,
      countryCodes,
      startYear: yrStart,
      endYear: yrEnd,
      metricKey: metricKey || undefined
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

router.get('/api/comparative', handleComparativeApi);

export default router;
