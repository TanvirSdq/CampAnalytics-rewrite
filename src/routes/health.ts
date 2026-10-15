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

    const parseNum = (val: any): number => {
      if (typeof val === 'number') return val;
      if (typeof val === 'string') {
        const cleaned = val.replace('%', '').trim();
        const n = parseFloat(cleaned);
        return isNaN(n) ? NaN : n;
      }
      return NaN;
    };

    const retRaw = parseNum(d.Retention?.raw);
    const retIsNaN = isNaN(retRaw);
    const retDelta = retIsNaN ? null : parseFloat((retRaw - b.retention).toFixed(1));

    const groCount = typeof d.Growth?.newcomers_count === 'number'
      ? d.Growth.newcomers_count
      : (parseNum(d.Growth?.raw) || 0);
    const groBm = b.expansion || b.growth || 180;
    const groDelta = Math.round(groCount - groBm);
    const groScoreNorm = d.Growth?.score !== null && !isNaN(d.Growth?.score) ? Math.min(100, Math.max(0, d.Growth.score)) : 70;

    const useRaw = parseNum(d.Usage?.raw);
    const useCount = typeof d.Usage?.count === 'number' ? d.Usage.count : null;
    const useDelta = isNaN(useRaw) ? null : parseFloat((useRaw - b.usage).toFixed(1));

    const qualRaw = parseNum(d.Quality?.raw);
    const qualCount = typeof d.Quality?.count === 'number' ? d.Quality.count : null;
    const qualDelta = isNaN(qualRaw) ? null : parseFloat((qualRaw - b.quality).toFixed(1));

    const divRaw = parseNum(d.Diversity?.raw);
    const divDelta = isNaN(divRaw) ? null : parseFloat((divRaw - b.diversity).toFixed(1));

    const scaleRaw = typeof d.Scale?.count === 'number' ? d.Scale.count : (typeof d.Scale?.raw === 'number' ? d.Scale.raw : parseNum(d.Scale?.raw));
    const scaleObserved = !isNaN(scaleRaw) ? scaleRaw : (result.target_users_count || 0);
    const scaleDelta = !isNaN(scaleObserved) && b.scale ? Math.round(scaleObserved - b.scale) : null;
    const scaleNormObserved = b.scale > 0 ? Math.min(100, Math.round(70 * (scaleObserved / b.scale))) : 70;

    benchmarkComparisons = [
      {
        id: 'scale',
        name: 'Community Scale',
        weight: d.Scale?.weight || 30,
        observedStr: `${scaleObserved.toLocaleString()} uploaders`,
        observedVal: scaleNormObserved,
        benchmarkStr: `${Math.round(b.scale).toLocaleString()} uploaders`,
        benchmarkVal: 70,
        deltaFormatted: scaleDelta !== null ? (scaleDelta >= 0 ? `▲ +${scaleDelta.toLocaleString()}` : `▼ ${scaleDelta.toLocaleString()}`) : '—',
        isPositive: scaleDelta !== null ? scaleDelta >= 0 : true,
        isInaugural: false,
        score: d.Scale?.score
      },
      {
        id: 'retention',
        name: 'Retention Index',
        weight: d.Retention?.weight || 20,
        observedStr: retIsNaN ? 'Inaugural' : `${retRaw.toFixed(1)}%`,
        observedVal: retIsNaN ? 0 : Math.min(100, Math.max(0, retRaw)),
        benchmarkStr: `${b.retention.toFixed(1)}%`,
        benchmarkVal: Math.min(100, Math.max(0, b.retention)),
        deltaFormatted: retDelta !== null ? (retDelta >= 0 ? `▲ +${retDelta.toFixed(1)}%` : `▼ ${retDelta.toFixed(1)}%`) : 'N/A',
        isPositive: retDelta !== null ? retDelta >= 0 : true,
        isInaugural: retIsNaN,
        score: d.Retention?.score
      },
      {
        id: 'usage',
        name: 'Content Utility',
        weight: d.Usage?.weight || 20,
        observedStr: d.Usage?.raw_formatted || (useCount !== null ? `${useCount.toLocaleString()} usages (${useRaw.toFixed(1)}%)` : (isNaN(useRaw) ? '—' : `${useRaw.toFixed(1)}%`)),
        observedVal: d.Usage?.score !== null && !isNaN(d.Usage?.score) ? Math.min(100, Math.max(0, d.Usage.score)) : 70,
        benchmarkStr: b.usage_count ? `${Math.round(b.usage_count).toLocaleString()} usages (${b.usage.toFixed(1)}%)` : `${b.usage.toFixed(1)}%`,
        benchmarkVal: 70,
        deltaFormatted: useDelta !== null ? (useDelta >= 0 ? `▲ +${useDelta.toFixed(1)}%` : `▼ ${useDelta.toFixed(1)}%`) : '—',
        isPositive: useDelta !== null ? useDelta >= 0 : true,
        isInaugural: false,
        score: d.Usage?.score
      },
      {
        id: 'growth',
        name: 'Contributor Expansion',
        weight: d.Growth?.weight || 10,
        observedStr: `${groCount.toLocaleString()} newcomers`,
        observedVal: groScoreNorm,
        benchmarkStr: `${Math.round(groBm).toLocaleString()} newcomers`,
        benchmarkVal: 70,
        deltaFormatted: groDelta !== null ? (groDelta >= 0 ? `▲ +${groDelta.toLocaleString()}` : `▼ ${groDelta.toLocaleString()}`) : '—',
        isPositive: groDelta !== null ? groDelta >= 0 : true,
        isInaugural: false,
        score: d.Growth?.score
      },
      {
        id: 'quality',
        name: 'Quality Recognition',
        weight: d.Quality?.weight || 10,
        observedStr: d.Quality?.raw_formatted || (qualCount !== null ? `${qualCount.toLocaleString()} works (${qualRaw.toFixed(1)}%)` : (isNaN(qualRaw) ? '—' : `${qualRaw.toFixed(1)}%`)),
        observedVal: d.Quality?.score !== null && !isNaN(d.Quality?.score) ? Math.min(100, Math.max(0, d.Quality.score)) : 70,
        benchmarkStr: b.quality_count ? `${Math.round(b.quality_count).toLocaleString()} works (${b.quality.toFixed(1)}%)` : `${b.quality.toFixed(1)}%`,
        benchmarkVal: 70,
        deltaFormatted: qualDelta !== null ? (qualDelta >= 0 ? `▲ +${qualDelta.toFixed(1)}%` : `▼ ${qualDelta.toFixed(1)}%`) : '—',
        isPositive: qualDelta !== null ? qualDelta >= 0 : true,
        isInaugural: false,
        score: d.Quality?.score
      },
      {
        id: 'diversity',
        name: 'Contributor Diversity',
        weight: d.Diversity?.weight || 10,
        observedStr: isNaN(divRaw) ? '—' : `${divRaw.toFixed(1)}%`,
        observedVal: isNaN(divRaw) ? 0 : Math.min(100, Math.max(0, divRaw)),
        benchmarkStr: `${b.diversity.toFixed(1)}%`,
        benchmarkVal: Math.min(100, Math.max(0, b.diversity)),
        deltaFormatted: divDelta !== null ? (divDelta <= 0 ? `▲ ${Math.abs(divDelta).toFixed(1)}% broader` : `▼ +${divDelta.toFixed(1)}% concentrated`) : '—',
        isPositive: divDelta !== null ? divDelta <= 0 : true,
        isInaugural: false,
        score: d.Diversity?.score
      }
    ];
  }

  res.render('health.html', {
    ...getGlobalContext(req),
    PAGE_TITLE: `CampTools - Evaluation: ${targetEvent.toUpperCase()}`,
    mode: 'Health Evaluation',
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
    insights: result ? result.insights : null,
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
