import { Router, Request, Response } from 'express';
import { getGlobalContext } from '../core/context.js';
import * as analytics from '../core/analytics.js';

import { parseCountryList, resolveCampaignQueryParams, asScalarString } from '../core/utils.js';

const router = Router();

export async function handleUtility(req: Request, res: Response): Promise<void> {
  const reqDict = req.method === 'POST' ? req.body : req.query;
  const currentYear = new Date().getFullYear();
  const currentY = currentYear - 1;

  const resolved = resolveCampaignQueryParams(reqDict, 'wlm');
  let targetCampaign = ((reqDict.target_campaign || reqDict.utility_event) as string || resolved.targetCampaign || '').trim();
  const eventType = resolved.eventType;
  const country = resolved.country;
  const year = ((reqDict.utility_year || reqDict.year) as string || '').trim();
  const yrStart = resolved.yrStart;
  const yrEnd = resolved.yrEnd;
  const countryList = resolved.countryList;

  if (req.method === 'GET' && Object.keys(req.query).length === 0 && !targetCampaign && countryList.length === 0) {
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

  // Only auto-derive single target campaign if countryList has exactly 1 country and no explicit targetCampaign
  if (!targetCampaign && countryList.length === 1) {
    const singleC = countryList[0];
    const yy = String(yrEnd % 100).padStart(2, '0');
    targetCampaign = `${eventType}${singleC}${yy}`;
  }

  let comparativeResult: analytics.ComparativeAnalyticsResult | null = null;
  let error: string | null = null;

  if (countryList.length > 0) {
    try {
      comparativeResult = await analytics.computeComparativeAnalytics({
        module: 'utility',
        eventType,
        countryCodes: countryList,
        startYear: yrStart,
        endYear: yrEnd,
        metricKey: (reqDict.metric || reqDict.metric_key || resolved.metric) as string
      });
    } catch (err: any) {
      console.error('Comparative utility computation failed:', err);
      if (countryList.length > 1) {
        error = `Comparative content utility computation failed: ${err.message}`;
      }
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
      error
    });
    return;
  }

  let utilityResult: any = null;

  if (targetCampaign) {
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
  }

  const mCode = targetCampaign ? analytics.CODE_RE.exec(targetCampaign.toLowerCase()) : null;

  res.render('utility.html', {
    ...getGlobalContext(req),
    PAGE_TITLE: targetCampaign ? `CampTools - Content Utility: ${targetCampaign.toUpperCase()}` : 'CampTools - Content Utility Comparison',
    mode: 'Content Utility',
    target_campaign: targetCampaign,
    utility_event_type: mCode ? mCode[1] : eventType || 'wlm',
    utility_country: mCode ? mCode[2] : country || (countryList[0] || 'de'),
    utility_year: mCode ? String(2000 + parseInt(mCode[3], 10)) : String(yrEnd),
    utility_result: utilityResult,
    comparative_result: comparativeResult,
    error
  });
}

export async function handleUtilityApi(req: Request, res: Response): Promise<void> {
  const countriesParam = asScalarString(req.query.countries || req.query.utility_countries).trim();
  if (countriesParam) {
    const countryCodes = parseCountryList(countriesParam);
    const eventType = asScalarString(req.query.event_type || req.query.utility_event_type, 'wlm').trim().toLowerCase();
    const yrStart = parseInt(asScalarString(req.query.yr_start || req.query.start_year), 10);
    const yrEnd = parseInt(asScalarString(req.query.yr_end || req.query.end_year), 10);
    const metricKey = asScalarString(req.query.metric || req.query.metric_key);

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
      console.error('Comparative utility API computation failed:', err);
      res.status(500).json({ error: 'An internal error occurred while processing comparative content utility.' });
      return;
    }
  }

  const targetCampaign = asScalarString(req.query.target_campaign || req.query.utility_event).trim();
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
    console.error('Utility deep computation failed:', err);
    res.status(500).json({ error: 'An internal error occurred while evaluating content utility.' });
  }
}

router.get('/utility', handleUtility);
router.post('/utility', handleUtility);
router.get('/api/utility', handleUtilityApi);

export default router;
