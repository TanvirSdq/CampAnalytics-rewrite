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
