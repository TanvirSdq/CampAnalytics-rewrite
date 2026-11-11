import { Router, Request, Response } from 'express';
import { getGlobalContext } from '../core/context.js';
import * as analytics from '../core/analytics.js';
import { parseCountryList, resolveCampaignQueryParams, asScalarString } from '../core/utils.js';

const router = Router();

export async function handleDiversity(req: Request, res: Response): Promise<void> {
  const reqDict = req.method === 'POST' ? req.body : req.query;
  const currentYear = new Date().getFullYear();
  const currentY = currentYear - 1;
  const defaultStart = Math.max(2010, currentY - 4);

  const resolved = resolveCampaignQueryParams(reqDict, 'wlm');
  const eventType = resolved.eventType;
  const country = resolved.country;
  const yrStart = resolved.yrStart;
  const yrEnd = resolved.yrEnd;
  const countryList = resolved.countryList;

  if (req.method === 'GET' && Object.keys(req.query).length === 0 && !country && countryList.length === 0) {
    res.render('diversity.html', {
      ...getGlobalContext(req),
      PAGE_TITLE: 'CampTools - Contributor Diversity',
      mode: 'Diversity',
      diversity_event_type: 'wlm',
      diversity_country: '',
      diversity_yr_start: defaultStart,
      diversity_yr_end: currentY,
      diversity_result: null,
      comparative_result: null,
      error: null
    });
    return;
  }

  const primaryCountry = countryList[0] || country || 'de';

  let diversityResult: analytics.DiversityResult | null = null;
  let comparativeResult: analytics.ComparativeAnalyticsResult | null = null;
  let error: string | null = null;

  try {
    diversityResult = await analytics.computeDiversityAnalytics({
      eventType,
      countryCode: primaryCountry,
      startYear: yrStart,
      endYear: yrEnd
    });
  } catch (err: any) {
    console.error('Diversity computation failed:', err);
    error = err.message;
  }

  if (countryList.length > 1) {
    try {
      comparativeResult = await analytics.computeComparativeAnalytics({
        module: 'diversity',
        eventType,
        countryCodes: countryList,
        startYear: yrStart,
        endYear: yrEnd,
        metricKey: (reqDict.metric || reqDict.metric_key || resolved.metric) as string
      });
    } catch (err: any) {
      console.error('Comparative diversity computation failed:', err);
      if (!error) {
        error = `Comparative contributor diversity computation failed: ${err.message}`;
      }
    }
  }

  res.render('diversity.html', {
    ...getGlobalContext(req),
    PAGE_TITLE: 'CampTools - Contributor Diversity',
    mode: 'Diversity',
    diversity_event_type: eventType,
    diversity_country: primaryCountry,
    diversity_yr_start: yrStart,
    diversity_yr_end: yrEnd,
    diversity_result: diversityResult,
    comparative_result: comparativeResult,
    error
  });
}

export async function handleDiversityApi(req: Request, res: Response): Promise<void> {
  const countriesParam = asScalarString(req.query.countries || req.query.diversity_countries).trim();
  const countryCodes = countriesParam ? parseCountryList(countriesParam) : [];
  const eventType = asScalarString(req.query.event_type || req.query.diversity_event_type, 'wlm').trim().toLowerCase();
  const yrStart = parseInt(asScalarString(req.query.yr_start || req.query.start_year), 10);
  const yrEnd = parseInt(asScalarString(req.query.yr_end || req.query.end_year), 10);
  const metricKey = asScalarString(req.query.metric || req.query.metric_key);

  if (countryCodes.length > 0) {
    try {
      const result = await analytics.computeComparativeAnalytics({
        module: 'diversity',
        eventType,
        countryCodes,
        startYear: yrStart,
        endYear: yrEnd,
        metricKey
      });
      res.json(result);
      return;
    } catch (err: any) {
      console.error('Comparative diversity API failed:', err);
      res.status(500).json({ error: 'An internal error occurred while processing comparative diversity.' });
      return;
    }
  }

  const country = asScalarString(req.query.country || req.query.diversity_country, 'de').trim().toLowerCase();
  try {
    const diversityResult = await analytics.computeDiversityAnalytics({
      eventType,
      countryCode: country,
      startYear: yrStart || undefined,
      endYear: yrEnd || undefined
    });
    res.json(diversityResult);
  } catch (err: any) {
    console.error('Diversity API failed:', err);
    res.status(500).json({ error: 'An internal error occurred while evaluating contributor diversity.' });
  }
}

router.get('/diversity', handleDiversity);
router.post('/diversity', handleDiversity);
router.get('/api/diversity', handleDiversityApi);

export default router;
