import { Router, Request, Response } from 'express';
import { getGlobalContext } from '../core/context.js';
import * as analytics from '../core/analytics.js';
import { HealthEvaluationResult } from '../core/types.js';
import { asScalarString } from '../core/utils.js';

const router = Router();

export async function handleHealth(req: Request, res: Response): Promise<void> {
  const reqDict = req.method === 'POST' ? req.body : req.query;
  let targetEvent = asScalarString(reqDict.target_event).trim();
  const compMode = asScalarString(reqDict.comp_mode) || 'Previous Year Baseline';
  const baselineEventInput = asScalarString(reqDict.baseline_event).trim();
  let region = asScalarString(reqDict.region).trim();
  const healthEvt = asScalarString(reqDict.health_event_type).trim().toLowerCase();
  const healthCc = asScalarString(reqDict.health_country).trim().toLowerCase();
  const healthYr = asScalarString(reqDict.health_year).trim();

  if (req.method === 'GET' && Object.keys(req.query).length === 0) {
    res.render('health.html', {
      ...getGlobalContext(req),
      PAGE_TITLE: 'CampTools - Event Performance',
      mode: 'Event Performance',
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
    return;
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

  if (!targetEvent) {
    res.render('health.html', {
      ...getGlobalContext(req),
      PAGE_TITLE: 'CampTools - Event Performance',
      mode: 'Event Performance',
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
    return;
  }

  let error: string | null = null;
  let result: HealthEvaluationResult | null = null;

  try {
    const isCustomMode =
      compMode === 'Custom Baseline Edition' ||
      compMode === 'Custom Verification Code' ||
      compMode === 'Custom Baseline Campaign';
    const customBaseline = isCustomMode && baselineEventInput ? baselineEventInput : undefined;
    result = await analytics.computeHealthEvaluation(targetEvent, region || undefined, customBaseline);
  } catch (err: any) {
    error = err.message;
  }

  let benchmarkComparisons = null;
  if (result && result.dimensions && result.benchmarks) {
    const d = result.dimensions;
    const b = result.benchmarks;

    const groVal = typeof b.expansion === 'number' ? b.expansion : (typeof b.growth === 'number' ? b.growth : (typeof b.newcomers === 'number' ? b.newcomers : null));

    benchmarkComparisons = [
      {
        id: 'scale',
        name: 'Community Scale',
        observedStr: d.Scale?.raw || `${result.target_users_count.toLocaleString()} uploaders`,
        observedVal: d.Scale?.count || result.target_users_count || 0,
        benchmarkStr: typeof b.scale === 'number' ? `${Math.round(b.scale).toLocaleString()} uploaders` : '—',
        benchmarkVal: typeof b.scale === 'number' ? Math.round(b.scale) : null,
        deltaFormatted: d.Scale?.yoy_delta_formatted || '—',
        isPositive: d.Scale?.is_positive !== false,
        isInaugural: d.Scale?.is_inaugural || false
      },
      {
        id: 'retention',
        name: 'Contributor Retention',
        observedStr: d.Retention?.raw_formatted || d.Retention?.raw || '—',
        observedVal: typeof d.Retention?.yoy_delta_pct === 'number' ? d.Retention.yoy_delta_pct : 0,
        benchmarkStr: typeof b.retention === 'number' ? `${b.retention.toFixed(1)}%` : '—',
        benchmarkVal: typeof b.retention === 'number' ? b.retention : null,
        deltaFormatted: d.Retention?.yoy_delta_formatted || '—',
        isPositive: d.Retention?.is_positive !== false,
        isInaugural: d.Retention?.is_inaugural || false
      },
      {
        id: 'growth',
        name: 'Newcomer Recruitment',
        observedStr: d.Growth?.raw_formatted || d.Growth?.raw || '—',
        observedVal: d.Growth?.count || 0,
        benchmarkStr: groVal !== null ? `${Math.round(groVal).toLocaleString()} newcomers` : '—',
        benchmarkVal: groVal !== null ? Math.round(groVal) : null,
        deltaFormatted: d.Growth?.yoy_delta_formatted || '—',
        isPositive: d.Growth?.is_positive !== false,
        isInaugural: d.Growth?.is_inaugural || false
      },
      {
        id: 'uploads',
        name: 'Upload Volume',
        observedStr: d.Uploads?.raw || '—',
        observedVal: d.Uploads?.count || 0,
        benchmarkStr: '—',
        benchmarkVal: null,
        deltaFormatted: d.Uploads?.yoy_delta_formatted || '—',
        isPositive: d.Uploads?.is_positive !== false,
        isInaugural: d.Uploads?.is_inaugural || false
      },
      {
        id: 'usage',
        name: 'Content Utility',
        observedStr: d.Usage?.raw_formatted || `${d.Usage?.raw || 0}%`,
        observedVal: typeof d.Usage?.raw === 'number' ? d.Usage.raw : 0,
        benchmarkStr: typeof b.usage === 'number'
          ? (typeof b.usage_count === 'number'
              ? `${Math.round(b.usage_count).toLocaleString()} usages (${b.usage.toFixed(1)}%)`
              : `${b.usage.toFixed(1)}%`)
          : (typeof b.usage_count === 'number'
              ? `${Math.round(b.usage_count).toLocaleString()} usages`
              : '—'),
        benchmarkVal: typeof b.usage === 'number' ? b.usage : null,
        deltaFormatted: d.Usage?.yoy_delta_formatted || '—',
        isPositive: d.Usage?.is_positive !== false,
        isInaugural: false
      },
      {
        id: 'quality',
        name: 'Quality Recognition',
        observedStr: d.Quality?.raw_formatted || `${d.Quality?.raw || 0}%`,
        observedVal: typeof d.Quality?.raw === 'number' ? d.Quality.raw : 0,
        benchmarkStr: typeof b.quality === 'number'
          ? (typeof b.quality_count === 'number'
              ? `${Math.round(b.quality_count).toLocaleString()} works (${b.quality.toFixed(1)}%)`
              : `${b.quality.toFixed(1)}%`)
          : (typeof b.quality_count === 'number'
              ? `${Math.round(b.quality_count).toLocaleString()} works`
              : '—'),
        benchmarkVal: typeof b.quality === 'number' ? b.quality : null,
        deltaFormatted: d.Quality?.yoy_delta_formatted || '—',
        isPositive: d.Quality?.is_positive !== false,
        isInaugural: false
      },
      {
        id: 'diversity',
        name: 'Contributor Diversity',
        observedStr: d.Diversity?.raw_formatted || `${d.Diversity?.raw || 0}%`,
        observedVal: typeof d.Diversity?.raw === 'number' ? d.Diversity.raw : 0,
        benchmarkStr: typeof b.diversity === 'number' ? `${b.diversity.toFixed(1)}%` : '—',
        benchmarkVal: typeof b.diversity === 'number' ? b.diversity : null,
        deltaFormatted: d.Diversity?.yoy_delta_formatted || '—',
        isPositive: d.Diversity?.is_positive !== false,
        isInaugural: false
      }
    ];
  }

  res.render('health.html', {
    ...getGlobalContext(req),
    PAGE_TITLE: `CampTools - Event Performance: ${targetEvent.toUpperCase()}`,
    mode: 'Event Performance',
    target_event: targetEvent,
    health_event_type: healthEvt,
    health_country: healthCc,
    health_year: healthYr,
    comp_mode: compMode,
    baseline_event: baselineEventInput || (result ? result.baseline_campaign : ''),
    region: result ? result.region : region,
    error,
    metrics: result ? result.dimensions : null,
    benchmarks_median: result ? result.benchmarks_median : null,
    benchmarks_mean: result ? result.benchmarks_mean : null,
    benchmark_comparisons: benchmarkComparisons,
    historical_series: result ? result.historical_series : [],
    peer_comparisons: result ? result.peer_comparisons : [],
    insights: null,
    target_users_count: result ? result.target_users_count : 0,
    base_users_count: result ? result.baseline_users_count : 0,
    intersect_users_count: result ? result.overlap_users_count : 0,
    overall_report: result ? result.overall_report : null
  });
}

export async function handleHealthApi(req: Request, res: Response): Promise<void> {
  const targetCampaign = asScalarString(req.query.target_campaign).trim();
  if (!targetCampaign) {
    res.status(400).json({ error: 'Missing target_campaign parameter' });
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
    const region = asScalarString(req.query.region).trim();
    const baseline = asScalarString(req.query.baseline_campaign || req.query.baseline_event).trim();
    const healthResult = await analytics.computeHealthEvaluation(
      targetCampaign,
      region || undefined,
      baseline || undefined
    );
    res.json(healthResult);
  } catch (err: any) {
    console.error('[Health API Error]', err);
    res.status(500).json({ error: 'Internal server error while evaluating campaign performance.' });
  }
}

router.get('/health', handleHealth);
router.post('/health', handleHealth);
router.get('/api/health', handleHealthApi);

export default router;
