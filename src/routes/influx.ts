import { Router, Request, Response } from 'express';
import { getGlobalContext } from '../core/context.js';
import * as analytics from '../core/analytics.js';

import { parseCountryList, resolveCampaignQueryParams, asScalarString } from '../core/utils.js';

const router = Router();

export async function handleInflux(req: Request, res: Response): Promise<void> {
  const reqDict = req.method === 'POST' ? req.body : req.query;
  const currentYear = new Date().getFullYear();
  const currentY = currentYear;
  const defaultStart = currentY - 4;

  const resolved = resolveCampaignQueryParams(reqDict, 'wlm');
  const eventType = resolved.eventType;
  const country = resolved.country;
  const yrStart = resolved.yrStart;
  const yrEnd = resolved.yrEnd;
  let rawCodes = ((reqDict.influx_codes as string) || '').trim();
  const countryList = resolved.countryList;

  if (req.method === 'GET' && Object.keys(req.query).length === 0 && !rawCodes && countryList.length === 0) {
    res.render('influx.html', {
      ...getGlobalContext(req),
      PAGE_TITLE: 'CampTools - Contributor Influx',
      mode: 'New User Influx',
      influx_event_type: 'wlm',
      influx_country: '',
      influx_yr_start: defaultStart,
      influx_yr_end: currentY,
      influx_codes: '',
      chart_b64: '',
      influx_result: null,
      comparative_result: null,
      error: null
    });
    return;
  }

  if (!rawCodes && countryList.length === 1) {
    const singleC = countryList[0];
    const codesArr: string[] = [];
    const baselineStart = yrStart > 2010 ? yrStart - 1 : yrStart;
    for (let y = baselineStart; y <= yrEnd; y++) {
      codesArr.push(`${eventType}${singleC}${String(y % 100).padStart(2, '0')}`);
    }
    rawCodes = codesArr.join(' ');
  }

  let comparativeResult: analytics.ComparativeAnalyticsResult | null = null;
  let error: string | null = null;

  if (countryList.length > 0) {
    try {
      comparativeResult = await analytics.computeComparativeAnalytics({
        module: 'influx',
        eventType,
        countryCodes: countryList,
        startYear: yrStart,
        endYear: yrEnd,
        metricKey: (reqDict.metric || reqDict.metric_key || resolved.metric) as string
      });
    } catch (err: any) {
      console.error('Comparative influx computation failed:', err);
      if (countryList.length > 1) {
        error = `Comparative newcomer influx computation failed: ${err.message}`;
      }
    }
  }

  if (!rawCodes && countryList.length > 1) {
    // Multi-country comparative mode without manual single-stream raw codes
    res.render('influx.html', {
      ...getGlobalContext(req),
      PAGE_TITLE: 'CampTools - Contributor Influx Comparison',
      mode: 'New User Influx',
      influx_event_type: eventType,
      influx_country: countryList[0] || country,
      influx_yr_start: yrStart,
      influx_yr_end: yrEnd,
      influx_codes: '',
      chart_b64: '',
      influx_result: null,
      comparative_result: comparativeResult,
      error
    });
    return;
  }

  if (!rawCodes && !comparativeResult) {
    res.render('influx.html', {
      ...getGlobalContext(req),
      PAGE_TITLE: 'CampTools - Contributor Influx',
      mode: 'New User Influx',
      influx_event_type: eventType,
      influx_country: country,
      influx_yr_start: yrStart,
      influx_yr_end: yrEnd,
      influx_codes: '',
      chart_b64: '',
      influx_result: null,
      comparative_result: null,
      error
    });
    return;
  }

  const validCodes = rawCodes.split(/\s+/).filter((c) => analytics.CODE_RE.test(c));
  // When a span [yrStart, yrEnd] is selected via builder, ensure the year prior (yrStart - 1) is included as the baseline
  if ((reqDict.influx_yr_start || reqDict.yr_start) && country && yrStart > 2010 && validCodes.length > 0) {
    const priorYearCode = `${eventType}${country.toLowerCase()}${String((yrStart - 1) % 100).padStart(2, '0')}`;
    if (analytics.CODE_RE.test(priorYearCode) && !validCodes.some((c) => c.toLowerCase() === priorYearCode)) {
      validCodes.unshift(priorYearCode);
    }
  }
  let chartB64 = '';
  let influxResult: any = null;

  if (validCodes.length >= 2) {
    try {
      influxResult = await analytics.computeYoYInflux(validCodes);
      if (!influxResult.records.length || influxResult.records.every((r: any) => r.total_active === 0)) {
        const scopeNotice = analytics.getCampaignScopeNotice(eventType, country);
        error = scopeNotice || 'No participant records found for the selected campaign series on Wikimedia Commons.';
      } else {
        const countryName = country ? analytics.countryDisplayName(country) : '';
        const eventName = analytics.EVENT_MAP[eventType] || (eventType ? eventType.toUpperCase() : 'Campaigns');
        let chartTitle = eventType === 'all' ? 'All Campaigns' : `Wiki Loves ${eventName}`;
        if (countryName) {
          chartTitle += ` · ${countryName}`;
        }
        chartB64 = analytics.createInfluxBarchartSvg(influxResult.records, chartTitle);
      }
    } catch (err: any) {
      error = `Error evaluating influx trends: ${err.message}`;
    }
  } else if (!comparativeResult) {
    error = 'Please specify at least two chronological campaign editions to compute Year-over-Year influx.';
  }

  res.render('influx.html', {
    ...getGlobalContext(req),
    PAGE_TITLE: 'CampTools - Contributor Influx Trends',
    mode: 'New User Influx',
    influx_event_type: eventType,
    influx_country: country,
    influx_yr_start: yrStart,
    influx_yr_end: yrEnd,
    influx_codes: validCodes.length ? validCodes.join(' ') : rawCodes,
    influx_result: influxResult,
    comparative_result: comparativeResult,
    chart_b64: chartB64,
    error
  });
}

export async function handleInfluxApi(req: Request, res: Response): Promise<void> {
  const countriesParam = asScalarString(req.query.countries || req.query.influx_countries).trim();
  if (countriesParam) {
    const countryCodes = parseCountryList(countriesParam);
    const eventType = asScalarString(req.query.event_type || req.query.influx_event_type, 'wlm').trim().toLowerCase();
    const yrStart = parseInt(asScalarString(req.query.yr_start || req.query.start_year), 10);
    const yrEnd = parseInt(asScalarString(req.query.yr_end || req.query.end_year), 10);
    const metricKey = asScalarString(req.query.metric || req.query.metric_key);

    try {
      const comparativeResult = await analytics.computeComparativeAnalytics({
        module: 'influx',
        eventType,
        countryCodes,
        startYear: yrStart,
        endYear: yrEnd,
        metricKey
      });
      res.json(comparativeResult);
      return;
    } catch (err: any) {
      console.error('Comparative influx API computation failed:', err);
      res.status(500).json({ error: 'An internal error occurred while processing comparative newcomer influx.' });
      return;
    }
  }

  const influxCodes = asScalarString(req.query.influx_codes).trim();
  if (!influxCodes) {
    res.status(400).json({ error: 'Missing influx_codes or countries parameter' });
    return;
  }
  const rawCodes = influxCodes.split(/\s+/).filter(Boolean);
  const valid = rawCodes.map((c) => c.replace(/\s+/g, '').toLowerCase()).filter((c) => analytics.CODE_RE.test(c));
  if (!valid.length) {
    res.status(400).json({ error: 'No valid campaign codes found' });
    return;
  }
  try {
    const result = await analytics.computeYoYInflux(valid);
    res.json({ influx_codes: valid, records: result.records, profile: result.lifecycle, summary: result.summary });
  } catch (err: any) {
    console.error('Influx YoY computation failed:', err);
    res.status(500).json({ error: 'An internal error occurred while processing contributor influx trends.' });
  }
}

router.get('/influx', handleInflux);
router.post('/influx', handleInflux);
router.get('/api/influx', handleInfluxApi);

export default router;
