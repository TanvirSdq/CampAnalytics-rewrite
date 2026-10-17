import { Router, Request, Response } from 'express';
import { getGlobalContext } from '../core/context.js';
import * as analytics from '../core/analytics.js';

import { parseCountryList } from '../core/utils.js';

const router = Router();

export async function handleQuality(req: Request, res: Response): Promise<void> {
  const reqDict = req.method === 'POST' ? req.body : req.query;
  const currentYear = new Date().getFullYear();
  const currentY = currentYear - 1;
  const defaultStart = currentY - 4;

  let targetCampaign = ((reqDict.target_campaign || reqDict.quality_event) as string || '').trim();
  const eventType = ((reqDict.quality_event_type || reqDict.event_type) as string || '').trim().toLowerCase() || 'wlm';
  const country = ((reqDict.quality_country || reqDict.country) as string || '').trim().toLowerCase();
  const year = ((reqDict.quality_year || reqDict.year) as string || '').trim();
  const yrStart = parseInt((reqDict.quality_yr_start || reqDict.yr_start || reqDict.start_year) as string, 10) || defaultStart;
  const yrEnd = parseInt((reqDict.quality_yr_end || reqDict.yr_end || reqDict.end_year || year) as string, 10) || currentY;

  // Multi-country parsing
  const rawCountries = reqDict.countries || reqDict.quality_countries || country;
  const countryList = parseCountryList(rawCountries);

  if (req.method === 'GET' && Object.keys(req.query).length === 0 && !targetCampaign) {
    res.render('quality.html', {
      ...getGlobalContext(req),
      PAGE_TITLE: 'CampTools - Quality Recognition',
      mode: 'Quality Recognition',
      target_campaign: '',
      quality_event_type: 'wlm',
      quality_country: '',
      quality_year: String(currentYear - 1),
      quality_result: null,
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
        module: 'quality',
        eventType,
        countryCodes: countryList,
        startYear: yrStart,
        endYear: yrEnd,
        metricKey: (reqDict.metric || reqDict.metric_key) as string
      });
    } catch (err: any) {
      console.error('Comparative quality computation failed:', err);
    }
  }

  if (!targetCampaign && !comparativeResult) {
    res.render('quality.html', {
      ...getGlobalContext(req),
      PAGE_TITLE: 'CampTools - Quality Recognition',
      mode: 'Quality Recognition',
      target_campaign: '',
      quality_event_type: eventType || 'wlm',
      quality_country: country,
      quality_year: year || String(currentYear - 1),
      quality_result: null,
      comparative_result: null,
      error: null
    });
    return;
  }

  let error: string | null = null;
  let qualityResult: any = null;

  const m = analytics.CODE_RE.exec(targetCampaign.toLowerCase());
  if (!m && !comparativeResult) {
    error = `Invalid campaign code format '${targetCampaign}'. Please specify in standard syntax e.g. wlmde24, wlmbd24.`;
  } else if (m) {
    const [, evt, cc] = m;
    const scopeNotice = analytics.getCampaignScopeNotice(evt, cc);
    if (scopeNotice) {
      error = scopeNotice;
    } else {
      try {
        qualityResult = await analytics.computeQualityRecognitionDeep(targetCampaign);
      } catch (err: any) {
        error = `Error evaluating quality recognition: ${err.message}`;
      }
    }
  }

  res.render('quality.html', {
    ...getGlobalContext(req),
    PAGE_TITLE: targetCampaign ? `CampTools - Quality Recognition: ${targetCampaign.toUpperCase()}` : 'CampTools - Quality Recognition Comparison',
    mode: 'Quality Recognition',
    target_campaign: targetCampaign,
    quality_event_type: m ? m[1] : eventType || 'wlm',
    quality_country: m ? m[2] : country || (countryList[0] || 'de'),
    quality_year: m ? String(2000 + parseInt(m[3], 10)) : String(yrEnd),
    quality_result: qualityResult,
    comparative_result: comparativeResult,
    error
  });
}

export async function handleQualityApi(req: Request, res: Response): Promise<void> {
  const countriesParam = ((req.query.countries || req.query.quality_countries) as string || '').trim();
  if (countriesParam) {
    const countryCodes = countriesParam.split(/[,\s]+/).filter(Boolean);
    const eventType = ((req.query.event_type || req.query.quality_event_type) as string || 'wlm').trim().toLowerCase();
    const yrStart = parseInt((req.query.yr_start || req.query.start_year) as string, 10);
    const yrEnd = parseInt((req.query.yr_end || req.query.end_year) as string, 10);
    const metricKey = (req.query.metric || req.query.metric_key) as string;

    try {
      const result = await analytics.computeComparativeAnalytics({
        module: 'quality',
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

  const targetCampaign = ((req.query.target_campaign || req.query.quality_event) as string || '').trim();
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
    const qualityResult = await analytics.computeQualityRecognitionDeep(targetCampaign);
    res.json(qualityResult);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

router.get('/quality', handleQuality);
router.post('/quality', handleQuality);
router.get('/api/quality', handleQualityApi);

export default router;
