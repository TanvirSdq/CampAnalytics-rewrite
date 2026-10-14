import { Router, Request, Response } from 'express';
import { getGlobalContext } from '../core/context.js';
import * as analytics from '../core/analytics.js';

const router = Router();

export async function handleInflux(req: Request, res: Response): Promise<void> {
  const reqDict = req.method === 'POST' ? req.body : req.query;
  const currentYear = new Date().getFullYear();
  const currentY = currentYear - 1;
  const defaultStart = currentY - 4;

  const eventType = ((reqDict.influx_event_type as string) || 'wlm').trim().toLowerCase() || 'wlm';
  const country = ((reqDict.influx_country as string) || '').trim().toLowerCase();
  const yrStart = parseInt((reqDict.influx_yr_start || reqDict.start_year || reqDict.yr_start) as string, 10) || defaultStart;
  const yrEnd = parseInt((reqDict.influx_yr_end || reqDict.end_year || reqDict.yr_end) as string, 10) || currentY;
  let rawCodes = ((reqDict.influx_codes as string) || '').trim();

  // Multi-country parsing
  let countryList: string[] = [];
  const rawCountries = reqDict.countries || reqDict.influx_countries;
  if (Array.isArray(rawCountries)) {
    countryList = rawCountries.map(String).map((c) => c.trim().toLowerCase()).filter(Boolean);
  } else if (typeof rawCountries === 'string' && rawCountries.trim()) {
    countryList = rawCountries.split(/[,\s]+/).map((c) => c.trim().toLowerCase()).filter(Boolean);
  } else if (country) {
    countryList = country.split(/[,\s]+/).map((c) => c.trim().toLowerCase()).filter(Boolean);
  }

  if (req.method === 'GET' && Object.keys(req.query).length === 0) {
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
    for (let y = yrStart; y <= yrEnd; y++) {
      codesArr.push(`${eventType}${singleC}${String(y % 100).padStart(2, '0')}`);
    }
    rawCodes = codesArr.join(' ');
  }

  let comparativeResult: analytics.ComparativeAnalyticsResult | null = null;
  if (countryList.length > 0) {
    try {
      comparativeResult = await analytics.computeComparativeAnalytics({
        module: 'influx',
        eventType,
        countryCodes: countryList,
        startYear: yrStart,
        endYear: yrEnd,
        metricKey: (reqDict.metric || reqDict.metric_key) as string
      });
    } catch (err: any) {
      console.error('Comparative influx computation failed:', err);
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
      error: null
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
      error: null
    });
    return;
  }

  const validCodes = rawCodes.split(/\s+/).filter((c) => analytics.CODE_RE.test(c));
  let error: string | null = null;
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
  const countriesParam = ((req.query.countries || req.query.influx_countries) as string || '').trim();
  if (countriesParam) {
    const countryCodes = countriesParam.split(/[,\s]+/).filter(Boolean);
    const eventType = ((req.query.event_type || req.query.influx_event_type) as string || 'wlm').trim().toLowerCase();
    const yrStart = parseInt((req.query.yr_start || req.query.start_year) as string, 10);
    const yrEnd = parseInt((req.query.yr_end || req.query.end_year) as string, 10);
    const metricKey = (req.query.metric || req.query.metric_key) as string;

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
      res.status(500).json({ error: err.message });
      return;
    }
  }

  const influxCodes = ((req.query.influx_codes as string) || '').trim();
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
    res.status(500).json({ error: err.message });
  }
}

router.get('/influx', handleInflux);
router.post('/influx', handleInflux);
router.get('/api/influx', handleInfluxApi);

export default router;
