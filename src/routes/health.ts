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

    const groRaw = parseNum(d.Growth?.raw);
    const groDelta = isNaN(groRaw) ? null : parseFloat((groRaw - b.growth).toFixed(1));

    const useRaw = parseNum(d.Usage?.raw);
    const useDelta = isNaN(useRaw) ? null : parseFloat((useRaw - b.usage).toFixed(1));

    const qualRaw = parseNum(d.Quality?.raw);
    const qualDelta = isNaN(qualRaw) ? null : parseFloat((qualRaw - b.quality).toFixed(1));

    const divRaw = parseNum(d.Diversity?.raw);
    const divDelta = isNaN(divRaw) ? null : parseFloat((divRaw - b.diversity).toFixed(1));

    benchmarkComparisons = [
      {
        id: 'retention',
        name: 'Retention Index',
        weight: d.Retention?.weight || 25,
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
        id: 'growth',
        name: 'Growth Capacity',
        weight: d.Growth?.weight || 25,
        observedStr: isNaN(groRaw) ? '—' : `${groRaw.toFixed(1)}%`,
        observedVal: isNaN(groRaw) ? 0 : Math.min(100, Math.max(0, groRaw)),
        benchmarkStr: `${b.growth.toFixed(1)}%`,
        benchmarkVal: Math.min(100, Math.max(0, b.growth)),
        deltaFormatted: groDelta !== null ? (groDelta >= 0 ? `▲ +${groDelta.toFixed(1)}%` : `▼ ${groDelta.toFixed(1)}%`) : '—',
        isPositive: groDelta !== null ? groDelta >= 0 : true,
        isInaugural: false,
        score: d.Growth?.score
      },
      {
        id: 'usage',
        name: 'Content Utility',
        weight: d.Usage?.weight || 20,
        observedStr: isNaN(useRaw) ? '—' : `${useRaw.toFixed(1)}%`,
        observedVal: isNaN(useRaw) ? 0 : Math.min(100, Math.max(0, useRaw)),
        benchmarkStr: `${b.usage.toFixed(1)}%`,
        benchmarkVal: Math.min(100, Math.max(0, b.usage)),
        deltaFormatted: useDelta !== null ? (useDelta >= 0 ? `▲ +${useDelta.toFixed(1)}%` : `▼ ${useDelta.toFixed(1)}%`) : '—',
        isPositive: useDelta !== null ? useDelta >= 0 : true,
        isInaugural: false,
        score: d.Usage?.score
      },
      {
        id: 'quality',
        name: 'Quality Recognition',
        weight: d.Quality?.weight || 15,
        observedStr: isNaN(qualRaw) ? '—' : `${qualRaw.toFixed(1)}%`,
        observedVal: isNaN(qualRaw) ? 0 : Math.min(100, Math.max(0, qualRaw)),
        benchmarkStr: `${b.quality.toFixed(1)}%`,
        benchmarkVal: Math.min(100, Math.max(0, b.quality)),
        deltaFormatted: qualDelta !== null ? (qualDelta >= 0 ? `▲ +${qualDelta.toFixed(1)}%` : `▼ ${qualDelta.toFixed(1)}%`) : '—',
        isPositive: qualDelta !== null ? qualDelta >= 0 : true,
        isInaugural: false,
        score: d.Quality?.score
      },
      {
        id: 'diversity',
        name: 'Contributor Diversity',
        weight: d.Diversity?.weight || 15,
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
    comp_mode: compMode,
    baseline_event: baselineEventInput || (result ? result.baseline_campaign : ''),
    region: result ? result.region : region,
    error,
    metrics: result ? result.dimensions : null,
    benchmark_comparisons: benchmarkComparisons,
    insights: result ? result.insights : null,
    target_users_count: result ? result.target_users_count : 0,
    base_users_count: result ? result.baseline_users_count : 0,
    intersect_users_count: result ? result.overlap_users_count : 0
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
