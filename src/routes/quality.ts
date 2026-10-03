import { Router, Request, Response } from 'express';
import { getGlobalContext } from '../core/context.js';
import * as analytics from '../core/analytics.js';

const router = Router();

export async function handleQuality(req: Request, res: Response): Promise<void> {
  const reqDict = req.method === 'POST' ? req.body : req.query;
  const currentYear = new Date().getFullYear();
  let targetCampaign = ((reqDict.target_campaign || reqDict.quality_event) as string || '').trim();
  const eventType = ((reqDict.quality_event_type as string) || '').trim().toLowerCase();
  const country = ((reqDict.quality_country as string) || '').trim().toLowerCase();
  const year = ((reqDict.quality_year as string) || '').trim();

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
      error: null
    });
    return;
  }

  if (!targetCampaign && country && year) {
    const evt = eventType || 'wlm';
    const yy = String(parseInt(year, 10) % 100).padStart(2, '0');
    targetCampaign = `${evt}${country}${yy}`;
  }

  if (!targetCampaign) {
    res.render('quality.html', {
      ...getGlobalContext(req),
      PAGE_TITLE: 'CampTools - Quality Recognition',
      mode: 'Quality Recognition',
      target_campaign: '',
      quality_event_type: eventType || 'wlm',
      quality_country: country,
      quality_year: year || String(currentYear - 1),
      quality_result: null,
      error: null
    });
    return;
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

  res.render('quality.html', {
    ...getGlobalContext(req),
    PAGE_TITLE: `CampTools - Quality Recognition: ${targetCampaign.toUpperCase()}`,
    mode: 'Quality Recognition',
    target_campaign: targetCampaign,
    quality_event_type: m ? m[1] : eventType || 'wlm',
    quality_country: m ? m[2] : country || 'de',
    quality_year: m ? String(2000 + parseInt(m[3], 10)) : year || '2024',
    quality_result: qualityResult,
    error
  });
}

export async function handleQualityApi(req: Request, res: Response): Promise<void> {
  const targetCampaign = ((req.query.target_campaign || req.query.quality_event) as string || '').trim();
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
