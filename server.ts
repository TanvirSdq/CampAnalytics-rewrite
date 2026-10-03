import express, { Request, Response } from 'express';
import compression from 'compression';
import nunjucks from 'nunjucks';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

import * as analytics from './src/analytics.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(compression() as any);
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));

// Helper to allow .items(), .keys(), and .values() on plain JS objects in templates
function makeDict<T extends Record<string, any>>(obj: T): T {
  const d = { ...obj };
  Object.defineProperty(d, 'items', {
    value: function () {
      return Object.entries(this);
    },
    enumerable: false,
    configurable: true
  });
  Object.defineProperty(d, 'keys', {
    value: function () {
      return Object.keys(this);
    },
    enumerable: false,
    configurable: true
  });
  Object.defineProperty(d, 'values', {
    value: function () {
      return Object.values(this);
    },
    enumerable: false,
    configurable: true
  });
  return d;
}

// Jinja compatibility methods on String prototype
(String.prototype as any).format = function (...args: any[]) {
  const str = this.toString();
  if (str === '{:,}' || str.includes('{:,}')) {
    const val = Number(args[0]);
    return isNaN(val) ? String(args[0] ?? 0) : val.toLocaleString();
  }
  if (str.startsWith('%.') && str.endsWith('f')) {
    const digits = parseInt(str.slice(2, -1), 10) || 1;
    const val = Number(args[0]);
    return isNaN(val) ? String(args[0] ?? 0) : val.toFixed(digits);
  }
  return String(args[0] ?? '');
};

(String.prototype as any).startswith = function (prefix: string) {
  return this.startsWith(prefix);
};

(String.prototype as any).endswith = function (suffix: string) {
  return this.endsWith(suffix);
};

// Nunjucks Environment
const nunjucksEnv = nunjucks.configure(path.join(__dirname, 'templates'), {
  autoescape: true,
  express: app,
  watch: false,
  noCache: true
});

nunjucksEnv.addFilter('tojson', (obj: any) => {
  return (nunjucks.runtime as any).markSafe(JSON.stringify(obj === undefined ? null : obj));
});

nunjucksEnv.addFilter('format', (fmt: any, val: any) => {
  if (val === undefined || val === null) {
    if (typeof fmt === 'number') return fmt.toFixed(1);
    return '0.0';
  }
  const n = typeof val === 'number' ? val : parseFloat(val);
  if (isNaN(n)) return String(val);
  if (fmt === '%.1f' || fmt === '%.2f') {
    return n.toFixed(fmt === '%.2f' ? 2 : 1);
  }
  return n.toLocaleString();
});

// Load custom CSS
let customCss = '';
function getCustomCss(): string {
  try {
    return fs.readFileSync(path.join(__dirname, 'styles.css'), 'utf-8');
  } catch (e) {
    return customCss;
  }
}
customCss = getCustomCss();

const currentYear = new Date().getFullYear();

// Context Helper
function getGlobalContext(req: Request) {
  return {
    PAGE_TITLE: 'CampAnalytics - Event Evaluation',
    PAGE_ICON: '📊',
    KORIKATH_LOGO_URL: 'https://upload.wikimedia.org/wikipedia/commons/9/99/Project_Korikath_Logo-dark.svg',
    EVENT_MAP: makeDict(analytics.EVENT_MAP),
    EVENT_DISPLAY_MAP: analytics.EVENT_DISPLAY_MAP,
    EVENT_COUNTRY_SCOPE: analytics.EVENT_COUNTRY_SCOPE,
    COUNTRY_OPTIONS: analytics.COUNTRY_OPTIONS,
    COUNTRY_MAP: analytics.COUNTRY_MAP,
    REGION_COUNTRY_MAPPING: makeDict(analytics.REGION_COUNTRY_MAPPING),
    COUNTRY_TO_REGION: analytics.COUNTRY_TO_REGION,
    EXAMPLE_CODES: analytics.EXAMPLE_CODES,
    CUSTOM_CSS: getCustomCss(),
    TEXT_MUTED: '#54595d',
    CURRENT_YEAR: currentYear,
    DEFAULT_START_YEAR: currentYear - 4,
    request: {
      path: req.path,
      query: req.query
    }
  };
}

// Serve static assets
app.use('/styles.css', (req, res) => {
  res.type('text/css').send(getCustomCss());
});
app.get('/plotly.min.js', (req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, 'node_modules/plotly.js-dist-min/plotly.min.js'));
});
app.use(express.static(__dirname, { index: false }));

// Healthcheck
app.get('/healthz', (req: Request, res: Response) => {
  res.status(200).send('OK');
});

// Home page
app.get('/', (req: Request, res: Response) => {
  const mode = (req.query.mode as string) || 'Tools';
  if (mode === 'Retention Analytics' || mode === 'Retention') {
    return handleRetention(req, res);
  } else if (mode === 'Health Evaluation' || mode === 'Health') {
    return handleHealth(req, res);
  } else if (mode === 'New User Influx' || mode === 'Influx' || mode === 'New Users') {
    return handleInflux(req, res);
  } else if (mode === 'Content Utility' || mode === 'Utility') {
    return handleUtility(req, res);
  } else if (mode === 'Quality Recognition' || mode === 'Quality') {
    return handleQuality(req, res);
  } else if (
    ['Methodology', 'Methodology & Usage', 'info', 'Info', 'Documentation', 'Info & Documentation'].includes(mode)
  ) {
    return res.render('index.html', {
      ...getGlobalContext(req),
      mode: 'Info & Documentation'
    });
  }
  return res.render('index.html', {
    ...getGlobalContext(req),
    mode: 'Tools'
  });
});

app.get('/tools', (req: Request, res: Response) => {
  res.render('index.html', {
    ...getGlobalContext(req),
    mode: 'Tools'
  });
});

app.get(['/documentation', '/info', '/methodology'], (req: Request, res: Response) => {
  res.render('index.html', {
    ...getGlobalContext(req),
    mode: 'Info & Documentation'
  });
});

// ============================================================================
// RETENTION ANALYTICS ROUTE
// ============================================================================
async function handleRetention(req: Request, res: Response) {
  const reqDict = req.method === 'POST' ? req.body : req.query;
  let targetCampaigns = ((reqDict.target_campaigns as string) || '').trim();
  const viewMode = (reqDict.view_mode as string) || 'Table';
  const metricChoice = (reqDict.metric_choice as string) || 'Average';
  const builderCountry = ((reqDict.builder_country as string) || '').trim();
  const builderYrStart = ((reqDict.builder_yr_start as string) || '').trim();
  const builderYrEnd = ((reqDict.builder_yr_end as string) || '').trim();

  let builderEvents = reqDict.builder_events;
  if (!Array.isArray(builderEvents)) {
    builderEvents = builderEvents ? [builderEvents] : [];
  }

  if (!targetCampaigns && builderCountry && builderEvents.length > 0) {
    const y1 = parseInt(builderYrStart, 10) || currentYear - 2;
    const y2 = parseInt(builderYrEnd, 10) || currentYear;
    const targetCodes: string[] = [];

    if (builderCountry === 'ALL') {
      for (const e of builderEvents) {
        for (let y = y1; y <= y2; y++) {
          targetCodes.push(`${e}*${String(y % 100).padStart(2, '0')}`);
        }
      }
    } else if (builderCountry.startsWith('REG:')) {
      const ccs = builderCountry.substring(4).split(',');
      for (const e of builderEvents) {
        for (const cc of ccs) {
          for (let y = y1; y <= y2; y++) {
            targetCodes.push(`${e}${cc.trim().toLowerCase()}${String(y % 100).padStart(2, '0')}`);
          }
        }
      }
    } else {
      for (const e of builderEvents) {
        for (let y = y1; y <= y2; y++) {
          targetCodes.push(`${e}${builderCountry.toLowerCase()}${String(y % 100).padStart(2, '0')}`);
        }
      }
    }
    targetCampaigns = targetCodes.join(' ');
  }

  // Do not launch sample countries automatically on default landing
  if (!targetCampaigns && (req.method === 'GET' && Object.keys(req.query).length === 0)) {
    return res.render('index.html', {
      ...getGlobalContext(req),
      mode: 'Retention Analytics',
      target_campaigns: '',
      view_mode: 'Both',
      metric_choice: 'Average',
      error: null,
      tables: null,
      heatmaps: null,
      worldmap_html: '',
      total_heatmaps_count: 0,
      remaining_heatmaps_count: 0
    });
  }

  if (!targetCampaigns) {
    return res.render('index.html', {
      ...getGlobalContext(req),
      mode: 'Retention Analytics',
      target_campaigns: '',
      view_mode: 'Both',
      metric_choice: 'Average',
      error: null,
      tables: null,
      heatmaps: null,
      worldmap_html: '',
      total_heatmaps_count: 0,
      remaining_heatmaps_count: 0
    });
  }

  const rawCodes = targetCampaigns.split(/\s+/).filter(Boolean);
  const codes: string[] = [];
  for (const c of rawCodes) {
    const clean = c.replace(/\s+/g, '').toLowerCase();
    const mWild = /^(all|wla|wlf|wle|wlm|wlb)(\*|all)(\d{2})$/.exec(clean);
    if (mWild) {
      const [, evt, , yr] = mWild;
      for (const cc of analytics.COUNTRY_OPTIONS) {
        codes.push(`${evt}${cc}${yr}`);
      }
    } else {
      codes.push(clean);
    }
  }

  const valid = codes.filter((c) => analytics.CODE_RE.test(c));
  let error: string | null = null;
  let worldmapHtml = '';
  const tables: string[] = [];
  const heatmaps: Array<[string, string]> = [];
  let totalHeatmapsCount = 0;
  let remainingHeatmapsCount = 0;

  if (valid.length === 0) {
    error = 'Please provide valid campaign codes (e.g., wlmde21 wlmde22) or use the Selection Builder above.';
  } else {
    try {
      const participantResults = await analytics.fetchAllConcurrently(valid);
      const countryEvents: Record<string, Record<string, Set<string>>> = {};

      for (const code of valid) {
        const m = analytics.CODE_RE.exec(code);
        if (!m) continue;
        const [, , cc] = m;
        const participants = participantResults[code] || new Set<string>();
        if (analytics.COUNTRY_MAP[cc] && participants.size > 0) {
          if (!countryEvents[cc]) countryEvents[cc] = {};
          countryEvents[cc][code] = participants;
        }
      }

      const validCountries: Record<string, Record<string, Set<string>>> = {};
      for (const [cc, evts] of Object.entries(countryEvents)) {
        if (Object.keys(evts).length >= 2) {
          validCountries[cc] = evts;
        }
      }

      if (Object.keys(validCountries).length === 0) {
        const scopeNotices: string[] = [];
        for (const c of valid) {
          const m = analytics.CODE_RE.exec(c);
          if (m) {
            const [, e, cc] = m;
            const sn = analytics.getCampaignScopeNotice(e, cc);
            if (sn && !scopeNotices.includes(sn)) scopeNotices.push(sn);
          }
        }
        if (scopeNotices.length > 0) {
          error = scopeNotices.join(' ');
        } else {
          error = 'No comparative vectors resolved. Verify that at least two overlapping temporal editions exist for your selected countries.';
        }
      } else {
        const worldData = analytics.buildWorldData(validCountries, metricChoice);
        if (worldData.length > 0) {
          worldmapHtml = analytics.createWorldMapHtml(worldData, metricChoice);
        }

        const tableHtml = analytics.buildGlobalTable(validCountries);
        if (tableHtml) {
          tables.push(tableHtml);
        }

        const sortedCountries = Object.entries(validCountries).sort((a, b) => {
          const sumA = Object.values(a[1]).reduce((sum, u) => sum + u.size, 0);
          const sumB = Object.values(b[1]).reduce((sum, u) => sum + u.size, 0);
          return sumB - sumA;
        });

        totalHeatmapsCount = sortedCountries.length;
        const initialLimit = 6;
        for (const [countryCode, events] of sortedCountries.slice(0, initialLimit)) {
          const cName = analytics.countryDisplayName(countryCode);
          const svgB64 = analytics.createHeatmapSvg(events, cName);
          heatmaps.push([cName, svgB64]);
        }
        remainingHeatmapsCount = Math.max(0, totalHeatmapsCount - initialLimit);
      }
    } catch (err: any) {
      error = `Error processing retention analysis: ${err.message}`;
    }
  }

  res.render('index.html', {
    ...getGlobalContext(req),
    mode: 'Retention Analytics',
    target_campaigns: targetCampaigns,
    view_mode: viewMode,
    metric_choice: metricChoice,
    error,
    tables,
    heatmaps,
    worldmap_html: worldmapHtml,
    total_heatmaps_count: totalHeatmapsCount,
    remaining_heatmaps_count: remainingHeatmapsCount
  });
}

app.get('/retention', handleRetention);
app.post('/retention', handleRetention);

// Async pagination for Heatmaps
app.get('/api/retention/heatmaps', async (req: Request, res: Response) => {
  const targetCampaigns = ((req.query.target_campaigns as string) || '').trim();
  const offset = Math.max(0, parseInt(req.query.offset as string, 10) || 6);
  const limit = Math.max(1, Math.min(24, parseInt(req.query.limit as string, 10) || 6));

  if (!targetCampaigns) {
    return res.status(400).json({ error: 'Missing target_campaigns parameter', heatmaps: [] });
  }

  const rawCodes = targetCampaigns.split(/\s+/).filter(Boolean);
  const codes: string[] = [];
  for (const c of rawCodes) {
    const clean = c.replace(/\s+/g, '').toLowerCase();
    const mWild = /^(all|wla|wlf|wle|wlm|wlb)(\*|all)(\d{2})$/.exec(clean);
    if (mWild) {
      const [, evt, , yr] = mWild;
      for (const cc of analytics.COUNTRY_OPTIONS) codes.push(`${evt}${cc}${yr}`);
    } else {
      codes.push(clean);
    }
  }

  const valid = codes.filter((c) => analytics.CODE_RE.test(c));
  if (!valid.length) {
    return res.status(400).json({ error: 'No valid campaign codes found', heatmaps: [] });
  }

  const participantResults = await analytics.fetchAllConcurrently(valid);
  const countryEvents: Record<string, Record<string, Set<string>>> = {};
  for (const code of valid) {
    const m = analytics.CODE_RE.exec(code);
    if (!m) continue;
    const [, , cc] = m;
    const participants = participantResults[code] || new Set<string>();
    if (analytics.COUNTRY_MAP[cc] && participants.size > 0) {
      if (!countryEvents[cc]) countryEvents[cc] = {};
      countryEvents[cc][code] = participants;
    }
  }

  const validCountries = Object.entries(countryEvents).filter(([, evts]) => Object.keys(evts).length >= 2);
  validCountries.sort((a, b) => {
    const sumA = Object.values(a[1]).reduce((sum, u) => sum + u.size, 0);
    const sumB = Object.values(b[1]).reduce((sum, u) => sum + u.size, 0);
    return sumB - sumA;
  });

  const totalCount = validCountries.length;
  const sliceCountries = validCountries.slice(offset, offset + limit);

  const renderedHeatmaps = sliceCountries.map(([countryCode, events]) => {
    const cName = analytics.countryDisplayName(countryCode);
    const svgB64 = analytics.createHeatmapSvg(events, cName);
    return {
      country_code: countryCode,
      country_title: cName,
      heatmap_b64: svgB64
    };
  });

  const nextOffset = offset + renderedHeatmaps.length;
  const remainingCount = Math.max(0, totalCount - nextOffset);

  res.json({
    heatmaps: renderedHeatmaps,
    offset: nextOffset,
    limit,
    total_count: totalCount,
    has_more: remainingCount > 0,
    remaining_count: remainingCount
  });
});

// ============================================================================
// HEALTH EVALUATION ROUTE
// ============================================================================
async function handleHealth(req: Request, res: Response) {
  const reqDict = req.method === 'POST' ? req.body : req.query;
  let targetEvent = ((reqDict.target_event as string) || '').trim();
  const compMode = (reqDict.comp_mode as string) || 'Previous Year Baseline';
  const baselineEventInput = ((reqDict.baseline_event as string) || '').trim();
  let region = ((reqDict.region as string) || '').trim();
  const healthEvt = ((reqDict.health_event_type as string) || '').trim().toLowerCase();
  const healthCc = ((reqDict.health_country as string) || '').trim().toLowerCase();
  const healthYr = ((reqDict.health_year as string) || '').trim();

  const prevYearShort = String((currentYear - 1) % 100).padStart(2, '0');

  if (req.method === 'GET' && Object.keys(req.query).length === 0) {
    return res.render('index.html', {
      ...getGlobalContext(req),
      mode: 'Health Evaluation',
      target_event: '',
      comp_mode: 'Previous Year Baseline',
      baseline_event: '',
      region: '',
      error: null,
      metrics: null,
      insights: null,
      target_users_count: 0,
      base_users_count: 0,
      intersect_users_count: 0
    });
  }

  if (!targetEvent && healthCc && healthYr) {
    const evt = healthEvt || 'wlm';
    const yy = String(parseInt(healthYr, 10) % 100).padStart(2, '0');
    targetEvent = `${evt}${healthCc}${yy}`;
  }

  if (healthEvt && targetEvent) {
    const m = analytics.CODE_RE.exec(targetEvent.toLowerCase());
    if (m && m[1] !== healthEvt) {
      targetEvent = `${healthEvt}${m[2]}${m[3]}`;
    }
  }

  let error: string | null = null;
  let metrics: any = null;
  let insights: string[] | null = null;
  let targetUsersCount = 0;
  let baseUsersCount = 0;
  let intersectUsersCount = 0;

  if (!targetEvent) {
    return res.render('index.html', {
      ...getGlobalContext(req),
      mode: 'Health Evaluation',
      target_event: '',
      comp_mode: compMode,
      baseline_event: baselineEventInput,
      region,
      error: null,
      metrics: null,
      insights: null,
      target_users_count: 0,
      base_users_count: 0,
      intersect_users_count: 0
    });
  } else {
    const match = analytics.CODE_RE.exec(targetEvent.toLowerCase());
    if (!match) {
      error = `Anomaly detected in target campaign code syntax ('${targetEvent}'). Expected standard format: event prefix + 2-letter country code + 2-digit year (e.g., wlmbd24).`;
    } else {
      const [, eventType, targetCc, yearStr] = match;
      const yearInt = parseInt(yearStr, 10);
      const prevYearStr = String((yearInt - 1 + 100) % 100).padStart(2, '0');

      if (!region || !analytics.REGION_COUNTRY_MAPPING[region]) {
        region = analytics.COUNTRY_TO_REGION[targetCc] || 'Northern & Western Europe';
      }

      let baselineEvent = baselineEventInput;
      if (compMode === 'Previous Year Baseline') {
        baselineEvent = `${eventType}${targetCc}${prevYearStr}`;
      }

      if (!baselineEvent) {
        error = 'Comparative tracking requires a baseline event sequence.';
      } else {
        try {
          const regionalCountries = analytics.REGION_COUNTRY_MAPPING[region] || [];
          const scanPool = new Set<string>();
          for (const cc of regionalCountries) {
            scanPool.add(`${eventType}${cc}${yearStr}`);
            scanPool.add(`${eventType}${cc}${prevYearStr}`);
          }
          scanPool.add(baselineEvent.toLowerCase());
          scanPool.add(targetEvent.toLowerCase());

          const allFetched = await analytics.fetchAllConcurrently(Array.from(scanPool));
          const targetUsers = allFetched[targetEvent.toLowerCase()] || new Set<string>();
          const baseUsers = allFetched[baselineEvent.toLowerCase()] || new Set<string>();

          if (targetUsers.size === 0) {
            const scopeNotice = analytics.getCampaignScopeNotice(eventType, targetCc);
            error = scopeNotice || `Data acquisition notice: Could not retrieve participant data for target campaign (${targetEvent}).`;
          } else {
            targetUsersCount = targetUsers.size;
            baseUsersCount = baseUsers.size;
            let overlap = 0;
            for (const u of targetUsers) {
              if (baseUsers.has(u)) overlap++;
            }
            intersectUsersCount = overlap;

            // Peer benchmarks
            const peerVolumes = regionalCountries.map((cc) => {
              const tCode = `${eventType}${cc}${yearStr}`;
              return { cc, count: (allFetched[tCode] || new Set()).size };
            });
            peerVolumes.sort((a, b) => b.count - a.count);
            const top3 = peerVolumes.slice(0, 3).map((p) => p.cc);

            const structuralCodes = top3.map((cc) => `${eventType}${cc}${yearStr}`);
            structuralCodes.push(targetEvent.toLowerCase());
            const structuralMetrics = await analytics.fetchStructuralMetricsConcurrently(structuralCodes);

            const repRetentions: number[] = [];
            const repGrowths: number[] = [];
            const repQualityRates: number[] = [];
            const repDiversities: number[] = [];
            const repUsages: number[] = [];

            for (const cc of top3) {
              const tCode = `${eventType}${cc}${yearStr}`;
              const bCode = `${eventType}${cc}${prevYearStr}`;
              const tU = allFetched[tCode] || new Set<string>();
              const bU = allFetched[bCode] || new Set<string>();
              const struct = structuralMetrics[tCode] || {};

              if (bU.size > 0) {
                let o = 0;
                for (const u of tU) if (bU.has(u)) o++;
                repRetentions.push((o / bU.size) * 100);
              } else if (tU.size > 0) {
                repRetentions.push(15.0);
              }

              if (tU.size > 0) {
                let n = 0;
                for (const u of tU) if (!bU.has(u)) n++;
                repGrowths.push((n / tU.size) * 100);
                if (struct.quality_image_share !== undefined) repQualityRates.push(struct.quality_image_share);
                if (struct.top10_uploader_share !== undefined) repDiversities.push(struct.top10_uploader_share);
                if (struct.usage_share !== undefined) repUsages.push(struct.usage_share);
              }
            }

            function computeBayesianBenchmark(arr: number[], baselineGlobal: number, priorWeight = 3.0): number {
              if (!arr.length) return baselineGlobal;
              const n = arr.length;
              const sorted = [...arr].sort((a, b) => a - b);
              const bRegional =
                n >= 3 ? sorted[Math.floor(n * 0.75)] : arr.reduce((a, b) => a + b, 0) / n;
              const lambda = n / (n + priorWeight);
              const bEffective = lambda * bRegional + (1.0 - lambda) * baselineGlobal;
              return parseFloat(bEffective.toFixed(1));
            }

            const benchmarks = {
              retention: computeBayesianBenchmark(
                repRetentions,
                analytics.GLOBAL_MOVEMENT_BASELINES.retention
              ),
              growth: computeBayesianBenchmark(repGrowths, analytics.GLOBAL_MOVEMENT_BASELINES.growth),
              quality: computeBayesianBenchmark(
                repQualityRates,
                analytics.GLOBAL_MOVEMENT_BASELINES.quality
              ),
              diversity: computeBayesianBenchmark(
                repDiversities,
                analytics.GLOBAL_MOVEMENT_BASELINES.diversity
              ),
              usage: computeBayesianBenchmark(repUsages, analytics.GLOBAL_MOVEMENT_BASELINES.usage)
            };

            const targetStructural = structuralMetrics[targetEvent.toLowerCase()] || {
              quality_image_share: 0.0,
              top10_uploader_share: 100.0,
              usage_share: 0.0,
              total_uploads: 0
            };

            metrics = analytics.generateHealthMetrics(
              targetUsers,
              baseUsers,
              targetStructural,
              benchmarks
            );

            const counts = {
              target: targetUsersCount,
              base: baseUsersCount,
              overlap: intersectUsersCount
            };
            insights = analytics.generateInsights(metrics, region.split(' (')[0], benchmarks, counts);
          }
        } catch (err: any) {
          error = `Error evaluating campaign health: ${err.message}`;
        }
      }
    }
  }

  res.render('index.html', {
    ...getGlobalContext(req),
    mode: 'Health Evaluation',
    target_event: targetEvent,
    comp_mode: compMode,
    baseline_event: baselineEventInput,
    region,
    error,
    metrics,
    insights,
    target_users_count: targetUsersCount,
    base_users_count: baseUsersCount,
    intersect_users_count: intersectUsersCount
  });
}

app.get('/health', handleHealth);
app.post('/health', handleHealth);

// ============================================================================
// NEW USER INFLUX ROUTE
// ============================================================================
async function handleInflux(req: Request, res: Response) {
  const reqDict = req.method === 'POST' ? req.body : req.query;
  const currentY = currentYear - 1;
  const defaultStart = currentY - 4;

  const eventType = ((reqDict.influx_event_type as string) || 'wlm').trim().toLowerCase() || 'wlm';
  const country = ((reqDict.influx_country as string) || '').trim().toLowerCase();
  const yrStart = parseInt(reqDict.influx_yr_start as string, 10) || defaultStart;
  const yrEnd = parseInt(reqDict.influx_yr_end as string, 10) || currentY;
  let rawCodes = ((reqDict.influx_codes as string) || '').trim();

  // Do not launch sample countries automatically on default landing
  if (req.method === 'GET' && Object.keys(req.query).length === 0) {
    return res.render('index.html', {
      ...getGlobalContext(req),
      mode: 'New User Influx',
      influx_event_type: 'wlm',
      influx_country: '',
      influx_yr_start: defaultStart,
      influx_yr_end: currentY,
      influx_codes: '',
      chart_b64: '',
      influx_result: null,
      error: null
    });
  }

  if (!rawCodes && country) {
    const codesArr: string[] = [];
    for (let y = yrStart; y <= yrEnd; y++) {
      codesArr.push(`${eventType}${country}${String(y % 100).padStart(2, '0')}`);
    }
    rawCodes = codesArr.join(' ');
  }

  if (!rawCodes) {
    return res.render('index.html', {
      ...getGlobalContext(req),
      mode: 'New User Influx',
      influx_event_type: eventType,
      influx_country: country,
      influx_yr_start: yrStart,
      influx_yr_end: yrEnd,
      influx_codes: '',
      chart_b64: '',
      influx_result: null,
      error: null
    });
  }

  const validCodes = rawCodes.split(/\s+/).filter((c) => analytics.CODE_RE.test(c));
  let error: string | null = null;
  let chartB64 = '';
  let influxResult: any = null;

  if (validCodes.length < 2) {
    error = 'Please specify at least two chronological campaign editions to compute Year-over-Year influx.';
  } else {
    try {
      influxResult = await analytics.computeYoYInflux(validCodes);
      if (!influxResult.records.length || influxResult.records.every((r: any) => r.total_active === 0)) {
        const scopeNotice = analytics.getCampaignScopeNotice(eventType, country);
        error = scopeNotice || 'No participant records found for the selected campaign series on Wikimedia Commons.';
      } else {
        const countryName = analytics.countryDisplayName(country);
        const eventName = analytics.EVENT_MAP[eventType] || eventType.toUpperCase();
        const chartTitle = eventType === 'all' ? `All Campaigns · ${countryName}` : `Wiki Loves ${eventName} · ${countryName}`;
        chartB64 = analytics.createInfluxBarchartSvg(influxResult.records, chartTitle);
      }
    } catch (err: any) {
      error = `Error evaluating influx trends: ${err.message}`;
    }
  }

  res.render('index.html', {
    ...getGlobalContext(req),
    mode: 'New User Influx',
    influx_event_type: eventType,
    influx_country: country,
    influx_yr_start: yrStart,
    influx_yr_end: yrEnd,
    influx_codes: validCodes.length ? validCodes.join(' ') : rawCodes,
    influx_result: influxResult,
    chart_b64: chartB64,
    error
  });
}

app.get('/influx', handleInflux);
app.post('/influx', handleInflux);

// ============================================================================
// CONTENT UTILITY ROUTE
// ============================================================================
async function handleUtility(req: Request, res: Response) {
  const reqDict = req.method === 'POST' ? req.body : req.query;
  let targetCampaign = ((reqDict.target_campaign as string) || '').trim();
  const eventType = ((reqDict.utility_event_type as string) || '').trim().toLowerCase();
  const country = ((reqDict.utility_country as string) || '').trim().toLowerCase();
  const year = ((reqDict.utility_year as string) || '').trim();

  // Do not launch sample countries automatically on default landing
  if (req.method === 'GET' && Object.keys(req.query).length === 0) {
    return res.render('index.html', {
      ...getGlobalContext(req),
      mode: 'Content Utility',
      target_campaign: '',
      utility_event_type: 'wlm',
      utility_country: '',
      utility_year: String(currentYear - 1),
      utility_result: null,
      error: null
    });
  }

  if (!targetCampaign && country && year) {
    const evt = eventType || 'wlm';
    const yy = String(parseInt(year, 10) % 100).padStart(2, '0');
    targetCampaign = `${evt}${country}${yy}`;
  }

  if (!targetCampaign) {
    return res.render('index.html', {
      ...getGlobalContext(req),
      mode: 'Content Utility',
      target_campaign: '',
      utility_event_type: eventType || 'wlm',
      utility_country: country,
      utility_year: year || String(currentYear - 1),
      utility_result: null,
      error: null
    });
  }

  let error: string | null = null;
  let utilityResult: any = null;

  const m = analytics.CODE_RE.exec(targetCampaign.toLowerCase());
  if (!m) {
    error = `Invalid campaign code format '${targetCampaign}'. Please specify in standard syntax e.g. wlmde24, wlmit23.`;
  } else {
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

  res.render('index.html', {
    ...getGlobalContext(req),
    mode: 'Content Utility',
    target_campaign: targetCampaign,
    utility_event_type: m ? m[1] : eventType || 'wlm',
    utility_country: m ? m[2] : country || 'de',
    utility_year: m ? String(2000 + parseInt(m[3], 10)) : year || '2024',
    utility_result: utilityResult,
    error
  });
}

app.get('/utility', handleUtility);
app.post('/utility', handleUtility);

// ============================================================================
// QUALITY RECOGNITION ROUTE
// ============================================================================
async function handleQuality(req: Request, res: Response) {
  const reqDict = req.method === 'POST' ? req.body : req.query;
  let targetCampaign = ((reqDict.target_campaign as string) || '').trim();
  const eventType = ((reqDict.quality_event_type as string) || '').trim().toLowerCase();
  const country = ((reqDict.quality_country as string) || '').trim().toLowerCase();
  const year = ((reqDict.quality_year as string) || '').trim();

  // Do not launch sample countries automatically on default landing
  if (req.method === 'GET' && Object.keys(req.query).length === 0) {
    return res.render('index.html', {
      ...getGlobalContext(req),
      mode: 'Quality Recognition',
      target_campaign: '',
      quality_event_type: 'wlm',
      quality_country: '',
      quality_year: String(currentYear - 1),
      quality_result: null,
      error: null
    });
  }

  if (!targetCampaign && country && year) {
    const evt = eventType || 'wlm';
    const yy = String(parseInt(year, 10) % 100).padStart(2, '0');
    targetCampaign = `${evt}${country}${yy}`;
  }

  if (!targetCampaign) {
    return res.render('index.html', {
      ...getGlobalContext(req),
      mode: 'Quality Recognition',
      target_campaign: '',
      quality_event_type: eventType || 'wlm',
      quality_country: country,
      quality_year: year || String(currentYear - 1),
      quality_result: null,
      error: null
    });
  }

  let error: string | null = null;
  let qualityResult: any = null;

  const m = analytics.CODE_RE.exec(targetCampaign.toLowerCase());
  if (!m) {
    error = `Invalid campaign code format '${targetCampaign}'. Please specify in standard syntax e.g. wlmde24, wlmbd24.`;
  } else {
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

  res.render('index.html', {
    ...getGlobalContext(req),
    mode: 'Quality Recognition',
    target_campaign: targetCampaign,
    quality_event_type: m ? m[1] : eventType || 'wlm',
    quality_country: m ? m[2] : country || 'de',
    quality_year: m ? String(2000 + parseInt(m[3], 10)) : year || '2024',
    quality_result: qualityResult,
    error
  });
}

app.get('/quality', handleQuality);
app.post('/quality', handleQuality);

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).render('index.html', {
    ...getGlobalContext(req),
    mode: 'Tools',
    error: 'The requested page or endpoint could not be found (HTTP 404). Please select a tool from the suite below.'
  });
});

// 500 error handler
app.use((err: any, req: Request, res: Response, next: any) => {
  console.error('Express server error:', err);
  res.status(500).render('index.html', {
    ...getGlobalContext(req),
    mode: 'Tools',
    error: 'An internal server error occurred (HTTP 500). Please verify your campaign parameters or retry.'
  });
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Start Server
const PORT = 3000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`CampAnalytics server listening on http://${HOST}:${PORT}`);
});
