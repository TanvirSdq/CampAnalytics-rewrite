import { Router, Request, Response } from 'express';
import { getGlobalContext } from '../core/context.js';
import * as analytics from '../core/analytics.js';

const router = Router();

export async function handleDiversity(req: Request, res: Response): Promise<void> {
  const reqDict = req.method === 'POST' ? req.body : req.query;
  const currentYear = new Date().getFullYear();
  const currentY = currentYear - 1;
  const defaultStart = Math.max(2010, currentY - 4);

  const eventType = ((reqDict.diversity_event_type || reqDict.event_type) as string || 'wlm').trim().toLowerCase() || 'wlm';
  const country = ((reqDict.diversity_country || reqDict.country) as string || '').trim().toLowerCase();
  const yrStart = parseInt((reqDict.diversity_yr_start || reqDict.yr_start || reqDict.start_year) as string, 10) || defaultStart;
  const yrEnd = parseInt((reqDict.diversity_yr_end || reqDict.yr_end || reqDict.end_year) as string, 10) || currentY;

  // Multi-country parsing
  let countryList: string[] = [];
  const rawCountries = reqDict.countries || reqDict.diversity_countries;
  if (Array.isArray(rawCountries)) {
    countryList = rawCountries.map(String).map((c) => c.trim().toLowerCase()).filter(Boolean);
  } else if (typeof rawCountries === 'string' && rawCountries.trim()) {
    countryList = rawCountries.split(/[,\s]+/).map((c) => c.trim().toLowerCase()).filter(Boolean);
  } else if (country) {
    countryList = country.split(/[,\s]+/).map((c) => c.trim().toLowerCase()).filter(Boolean);
  }

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
        metricKey: (reqDict.metric || reqDict.metric_key) as string
      });
    } catch (err: any) {
      console.error('Comparative diversity computation failed:', err);
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

router.get('/diversity', handleDiversity);
router.post('/diversity', handleDiversity);

export default router;
