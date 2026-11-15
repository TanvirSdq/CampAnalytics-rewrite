import { Router, Request, Response } from 'express';
import { getGlobalContext } from '../core/context.js';
import * as analytics from '../core/analytics.js';

import { parseCountryList, resolveCampaignQueryParams, asScalarString } from '../core/utils.js';

const router = Router();

export async function handleQuality(req: Request, res: Response): Promise<void> {
  const reqDict = req.method === 'POST' ? req.body : req.query;
  const currentYear = new Date().getFullYear();
  const currentY = currentYear - 1;

  const resolved = resolveCampaignQueryParams(reqDict, 'wlm');
  let targetCampaign = ((reqDict.target_campaign || reqDict.quality_event) as string || resolved.targetCampaign || '').trim();
  const eventType = resolved.eventType;
  const country = resolved.country;
  const year = ((reqDict.quality_year || reqDict.year) as string || '').trim();
  const yrStart = resolved.yrStart;
  const yrEnd = resolved.yrEnd;
  const countryList = resolved.countryList;

  if (req.method === 'GET' && Object.keys(req.query).length === 0 && !targetCampaign && countryList.length === 0) {
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
        module: 'quality',
        eventType,
        countryCodes: countryList,
        startYear: yrStart,
        endYear: yrEnd,
        metricKey: (reqDict.metric || reqDict.metric_key || resolved.metric) as string
      });
    } catch (err: any) {
      console.error('Comparative quality computation failed:', err);
      if (countryList.length > 1) {
        error = `Comparative quality recognition computation failed: ${err.message}`;
      }
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
      error
    });
    return;
  }

  let qualityResult: any = null;

  if (targetCampaign) {
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
  }

  const mCode = targetCampaign ? analytics.CODE_RE.exec(targetCampaign.toLowerCase()) : null;

  res.render('quality.html', {
    ...getGlobalContext(req),
    PAGE_TITLE: targetCampaign ? `CampTools - Quality Recognition: ${targetCampaign.toUpperCase()}` : 'CampTools - Quality Recognition Comparison',
    mode: 'Quality Recognition',
    target_campaign: targetCampaign,
    quality_event_type: mCode ? mCode[1] : eventType || 'wlm',
    quality_country: mCode ? mCode[2] : country || (countryList[0] || 'de'),
    quality_year: mCode ? String(2000 + parseInt(mCode[3], 10)) : String(yrEnd),
    quality_result: qualityResult,
    comparative_result: comparativeResult,
    error
  });
}

export async function handleQualityApi(req: Request, res: Response): Promise<void> {
  const countriesParam = asScalarString(req.query.countries || req.query.quality_countries).trim();
  if (countriesParam) {
    const countryCodes = countriesParam.split(/[,\s]+/).filter(Boolean);
    const eventType = (asScalarString(req.query.event_type || req.query.quality_event_type) || 'wlm').trim().toLowerCase();
    const yrStart = parseInt(asScalarString(req.query.yr_start || req.query.start_year), 10);
    const yrEnd = parseInt(asScalarString(req.query.yr_end || req.query.end_year), 10);
    const metricKey = asScalarString(req.query.metric || req.query.metric_key);

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
      console.error('[Quality API Comparative Error]', err);
      res.status(500).json({ error: 'Internal server error while evaluating comparative quality recognition.' });
      return;
    }
  }

  const targetCampaign = asScalarString(req.query.target_campaign || req.query.quality_event).trim();
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
    console.error('[Quality API Error]', err);
    res.status(500).json({ error: 'Internal server error while evaluating quality recognition.' });
  }
}

router.get('/quality', handleQuality);
router.post('/quality', handleQuality);
router.get('/api/quality', handleQualityApi);

export default router;
