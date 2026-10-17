import { Router, Request, Response } from 'express';
import { getGlobalContext } from '../core/context.js';
import * as analytics from '../core/analytics.js';

import { parseCountryList } from '../core/utils.js';

const router = Router();

export async function handleUtility(req: Request, res: Response): Promise<void> {
  const reqDict = req.method === 'POST' ? req.body : req.query;
  const currentYear = new Date().getFullYear();
  const currentY = currentYear - 1;
  const defaultStart = currentY - 4;

  let targetCampaign = ((reqDict.target_campaign || reqDict.utility_event) as string || '').trim();
  const eventType = ((reqDict.utility_event_type || reqDict.event_type) as string || '').trim().toLowerCase() || 'wlm';
  const country = ((reqDict.utility_country || reqDict.country) as string || '').trim().toLowerCase();
  const year = ((reqDict.utility_year || reqDict.year) as string || '').trim();
  const yrStart = parseInt((reqDict.utility_yr_start || reqDict.yr_start || reqDict.start_year) as string, 10) || defaultStart;
  const yrEnd = parseInt((reqDict.utility_yr_end || reqDict.yr_end || reqDict.end_year || year) as string, 10) || currentY;

  // Multi-country parsing
  const rawCountries = reqDict.countries || reqDict.utility_countries || country;
  const countryList = parseCountryList(rawCountries);

  if (req.method === 'GET' && Object.keys(req.query).length === 0 && !targetCampaign) {
    res.render('utility.html', {
      ...getGlobalContext(req),
      PAGE_TITLE: 'CampTools - Content Utility',
      mode: 'Content Utility',
      target_campaign: '',
      utility_event_type: 'wlm',
      utility_country: '',
      utility_year: String(currentYear - 1),
      utility_result: null,
      comparative_result: null,
      error: null
    });
    return;
  }

  if (!targetCampaign && countryList.length > 0) {
    const singleC = countryList[0];
    const yy = String(yrEnd % 100).padStart(2, '0');
    targetCampaign = `${eventType}${singleC}${yy}`;
  }

  let comparativeResult: analytics.ComparativeAnalyticsResult | null = null;
  if (countryList.length > 0) {
    try {
      comparativeResult = await analytics.computeComparativeAnalytics({
        module: 'utility',
        eventType,
        countryCodes: countryList,
        startYear: yrStart,
        endYear: yrEnd,
        metricKey: (reqDict.metric || reqDict.metric_key) as string
      });
    } catch (err: any) {
      console.error('Comparative utility computation failed:', err);
    }
  }

  if (!targetCampaign && !comparativeResult) {
    res.render('utility.html', {
      ...getGlobalContext(req),
      PAGE_TITLE: 'CampTools - Content Utility',
      mode: 'Content Utility',
      target_campaign: '',
      utility_event_type: eventType || 'wlm',
      utility_country: country,
      utility_year: year || String(currentYear - 1),
      utility_result: null,
      comparative_result: null,
      error: null
    });
    return;
  }

  let error: string | null = null;
  let utilityResult: any = null;

  const m = analytics.CODE_RE.exec(targetCampaign.toLowerCase());
  if (!m && !comparativeResult) {
    error = `Invalid campaign code format '${targetCampaign}'. Please specify in standard syntax e.g. wlmde24, wlmit23.`;
  } else if (m) {
    const [, evt, cc] = m;
    const scopeNotice = analytics.getCampaignScopeNotice(evt, cc);
    if (scopeNotice) {
      error = scopeNotice;
    } else {
      try {
        utilityResult = await analytics.computeContentUtilityDeep(targetCampaign);
      } catch (err: any) {
        error = `Error evaluating content utility: ${err.message}`;
      }
    }
  }

  res.render('utility.html', {
    ...getGlobalContext(req),
    PAGE_TITLE: targetCampaign ? `CampTools - Content Utility: ${targetCampaign.toUpperCase()}` : 'CampTools - Content Utility Comparison',
    mode: 'Content Utility',
    target_campaign: targetCampaign,
    utility_event_type: m ? m[1] : eventType || 'wlm',
    utility_country: m ? m[2] : country || (countryList[0] || 'de'),
    utility_year: m ? String(2000 + parseInt(m[3], 10)) : String(yrEnd),
    utility_result: utilityResult,
    comparative_result: comparativeResult,
    error
  });
}

export async function handleUtilityApi(req: Request, res: Response): Promise<void> {
  const countriesParam = ((req.query.countries || req.query.utility_countries) as string || '').trim();
  if (countriesParam) {
    const countryCodes = countriesParam.split(/[,\s]+/).filter(Boolean);
    const eventType = ((req.query.event_type || req.query.utility_event_type) as string || 'wlm').trim().toLowerCase();
    const yrStart = parseInt((req.query.yr_start || req.query.start_year) as string, 10);
    const yrEnd = parseInt((req.query.yr_end || req.query.end_year) as string, 10);
    const metricKey = (req.query.metric || req.query.metric_key) as string;

    try {
      const result = await analytics.computeComparativeAnalytics({
        module: 'utility',
        eventType,
        countryCodes,
        startYear: yrStart,
        endYear: yrEnd,
        metricKey
      });
      res.json(result);
      return;
    } catch (err: any) {
      res.status(500).json({ error: err.message });
      return;
    }
  }

  const targetCampaign = ((req.query.target_campaign || req.query.utility_event) as string || '').trim();
  if (!targetCampaign) {
    res.status(400).json({ error: 'Missing target_campaign or countries parameter' });
    return;
  }
  const m = analytics.CODE_RE.exec(targetCampaign.toLowerCase());
  if (!m) {
    res.status(400).json({ error: `Invalid campaign code format '${targetCampaign}'` });
    return;
  }
  const [, evt, cc] = m;
  const scopeNotice = analytics.getCampaignScopeNotice(evt, cc);
  if (scopeNotice) {
    res.status(400).json({ error: scopeNotice });
    return;
  }
  try {
    const utilityResult = await analytics.computeContentUtilityDeep(targetCampaign);
    res.json(utilityResult);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

router.get('/utility', handleUtility);
router.post('/utility', handleUtility);
router.get('/api/utility', handleUtilityApi);

export default router;
