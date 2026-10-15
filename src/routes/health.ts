import { Router, Request, Response } from 'express';
import { getGlobalContext } from '../core/context.js';
import * as analytics from '../core/analytics.js';
import { HealthEvaluationResult } from '../core/types.js';

const router = Router();

export async function handleHealth(req: Request, res: Response): Promise<void> {
  const reqDict = req.method === 'POST' ? req.body : req.query;
  let targetEvent = ((reqDict.target_event as string) || '').trim();
  const compMode = (reqDict.comp_mode as string) || 'Previous Year Baseline';
  const baselineEventInput = ((reqDict.baseline_event as string) || '').trim();
  let region = ((reqDict.region as string) || '').trim();
  const healthEvt = ((reqDict.health_event_type as string) || '').trim().toLowerCase();
  const healthCc = ((reqDict.health_country as string) || '').trim().toLowerCase();
  const healthYr = ((reqDict.health_year as string) || '').trim();

  if (req.method === 'GET' && Object.keys(req.query).length === 0) {
    res.render('health.html', {
      ...getGlobalContext(req),
      PAGE_TITLE: 'CampTools - Event Evaluation',
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
      PAGE_TITLE: 'CampTools - Event Evaluation',
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
    return;
  }

  let error: string | null = null;
  let result: HealthEvaluationResult | null = null;

  try {
    result = await analytics.computeHealthEvaluation(targetEvent, region);
  } catch (err: any) {
    error = err.message;
  }

  let benchmarkComparisons = null;
  if (result && result.dimensions && result.benchmarks) {
    const d = result.dimensions;
    const b = result.benchmarks;

    benchmarkComparisons = [
      {
        id: 'scale',
        name: 'Community Scale',
        observedStr: d.Scale?.raw || `${result.target_users_count.toLocaleString()} uploaders`,
        observedVal: d.Scale?.count || result.target_users_count || 0,
        benchmarkStr: `${Math.round(b.scale).toLocaleString()} uploaders`,
        benchmarkVal: Math.round(b.scale),
        deltaFormatted: d.Scale?.yoy_delta_formatted || '—',
        isPositive: d.Scale?.is_positive !== false,
        isInaugural: d.Scale?.is_inaugural || false
      },
      {
        id: 'retention',
        name: 'Contributor Retention',
        observedStr: d.Retention?.raw_formatted || d.Retention?.raw || '—',
        observedVal: typeof d.Retention?.yoy_delta_pct === 'number' ? d.Retention.yoy_delta_pct : 0,
        benchmarkStr: `${b.retention.toFixed(1)}%`,
        benchmarkVal: b.retention,
        deltaFormatted: d.Retention?.yoy_delta_formatted || 'N/A',
        isPositive: d.Retention?.is_positive !== false,
        isInaugural: d.Retention?.is_inaugural || false
      },
      {
        id: 'growth',
        name: 'Newcomer Recruitment',
        observedStr: d.Growth?.raw_formatted || d.Growth?.raw || '—',
        observedVal: d.Growth?.count || 0,
        benchmarkStr: `${Math.round(b.expansion || b.growth || 180).toLocaleString()} newcomers`,
        benchmarkVal: Math.round(b.expansion || b.growth || 180),
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
        benchmarkVal: 0,
        deltaFormatted: d.Uploads?.yoy_delta_formatted || '—',
        isPositive: d.Uploads?.is_positive !== false,
        isInaugural: d.Uploads?.is_inaugural || false
      },
      {
        id: 'usage',
        name: 'Content Utility',
        observedStr: d.Usage?.raw_formatted || `${d.Usage?.raw || 0}%`,
        observedVal: typeof d.Usage?.raw === 'number' ? d.Usage.raw : 0,
        benchmarkStr: b.usage_count ? `${Math.round(b.usage_count).toLocaleString()} usages (${b.usage.toFixed(1)}%)` : `${b.usage.toFixed(1)}%`,
        benchmarkVal: b.usage,
        deltaFormatted: d.Usage?.yoy_delta_formatted || '—',
        isPositive: d.Usage?.is_positive !== false,
        isInaugural: false
      },
      {
        id: 'quality',
        name: 'Quality Recognition',
        observedStr: d.Quality?.raw_formatted || `${d.Quality?.raw || 0}%`,
        observedVal: typeof d.Quality?.raw === 'number' ? d.Quality.raw : 0,
        benchmarkStr: b.quality_count ? `${Math.round(b.quality_count).toLocaleString()} works (${b.quality.toFixed(1)}%)` : `${b.quality.toFixed(1)}%`,
        benchmarkVal: b.quality,
        deltaFormatted: d.Quality?.yoy_delta_formatted || '—',
        isPositive: d.Quality?.is_positive !== false,
        isInaugural: false
      },
      {
        id: 'diversity',
        name: 'Contributor Diversity',
        observedStr: d.Diversity?.raw_formatted || `${d.Diversity?.raw || 0}%`,
        observedVal: typeof d.Diversity?.raw === 'number' ? d.Diversity.raw : 0,
        benchmarkStr: `${b.diversity.toFixed(1)}%`,
        benchmarkVal: b.diversity,
        deltaFormatted: d.Diversity?.yoy_delta_formatted || '—',
        isPositive: d.Diversity?.is_positive !== false,
        isInaugural: false
      }
    ];
  }

  res.render('health.html', {
    ...getGlobalContext(req),
    PAGE_TITLE: `CampTools - Dynamics: ${targetEvent.toUpperCase()}`,
    mode: 'Campaign Dynamics',
    target_event: targetEvent,
    health_event_type: healthEvt,
    health_country: healthCc,
    health_year: healthYr,
    comp_mode: compMode,
    baseline_event: baselineEventInput || (result ? result.baseline_campaign : ''),
    region: result ? result.region : region,
    error,
    metrics: result ? result.dimensions : null,
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
  const targetCampaign = ((req.query.target_campaign as string) || '').trim();
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
    const healthResult = await analytics.computeHealthEvaluation(targetCampaign, req.query.region as string);
    res.json(healthResult);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

router.get('/health', handleHealth);
router.post('/health', handleHealth);
router.get('/api/health', handleHealthApi);

export default router;
