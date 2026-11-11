import { Router, Request, Response } from 'express';
import { computeComparativeAnalytics } from '../core/analytics.js';
import { parseCountryList, asScalarString } from '../core/utils.js';

const router = Router();

export async function handleComparativeApi(req: Request, res: Response): Promise<void> {
  const moduleParam = asScalarString(req.query.module, 'influx').trim().toLowerCase();
  if (!['influx', 'retention', 'quality', 'utility', 'diversity', 'mobility'].includes(moduleParam)) {
    res.status(400).json({
      error: `Invalid module '${moduleParam}'. Supported modules: influx, retention, quality, utility, diversity, mobility.`
    });
    return;
  }

  const eventType = asScalarString(req.query.event_type || req.query.eventType, 'wlm').trim().toLowerCase();
  const rawCountries = req.query.countries || req.query.country_codes || req.query.countryCodes;
  const countryCodes = parseCountryList(rawCountries);

  const yrStart = parseInt(asScalarString(req.query.start_year || req.query.startYear || req.query.yr_start), 10);
  const yrEnd = parseInt(asScalarString(req.query.end_year || req.query.endYear || req.query.yr_end), 10);
  const metricKey = asScalarString(req.query.metric || req.query.metric_key || req.query.metricKey).trim();

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
    console.error('Comparative API error:', err);
    res.status(500).json({ error: 'An internal error occurred while processing the comparative request.' });
  }
}

router.get('/api/comparative', handleComparativeApi);

export default router;
