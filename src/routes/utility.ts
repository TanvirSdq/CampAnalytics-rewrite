import { Router, Request, Response } from 'express';
import { getGlobalContext } from '../core/context.js';
import * as analytics from '../core/analytics.js';

const router = Router();

export async function handleUtility(req: Request, res: Response): Promise<void> {
  const reqDict = req.method === 'POST' ? req.body : req.query;
  const currentYear = new Date().getFullYear();
  let targetCampaign = ((reqDict.target_campaign || reqDict.utility_event) as string || '').trim();
  const eventType = ((reqDict.utility_event_type as string) || '').trim().toLowerCase();
  const country = ((reqDict.utility_country as string) || '').trim().toLowerCase();
  const year = ((reqDict.utility_year as string) || '').trim();

  if (req.method === 'GET' && Object.keys(req.query).length === 0 && !targetCampaign) {
    res.render('utility.html', {
      ...getGlobalContext(req),
      PAGE_TITLE: 'CampTools - Content Utility',
      mode: 'Content Utility',
      target_campaign: '',
      utility_event_type: 'wlm',
      utility_country: '',
      utility_year: String(currentYear - 1),
      utility_result: null,
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
    res.render('utility.html', {
      ...getGlobalContext(req),
      PAGE_TITLE: 'CampTools - Content Utility',
      mode: 'Content Utility',
      target_campaign: '',
      utility_event_type: eventType || 'wlm',
      utility_country: country,
      utility_year: year || String(currentYear - 1),
      utility_result: null,
      error: null
    });
    return;
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

  res.render('utility.html', {
    ...getGlobalContext(req),
    PAGE_TITLE: `CampTools - Content Utility: ${targetCampaign.toUpperCase()}`,
    mode: 'Content Utility',
    target_campaign: targetCampaign,
    utility_event_type: m ? m[1] : eventType || 'wlm',
    utility_country: m ? m[2] : country || 'de',
    utility_year: m ? String(2000 + parseInt(m[3], 10)) : year || '2024',
    utility_result: utilityResult,
    error
  });
}

export async function handleUtilityApi(req: Request, res: Response): Promise<void> {
  const targetCampaign = ((req.query.target_campaign || req.query.utility_event) as string || '').trim();
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
    const utilityResult = await analytics.computeContentUtilityDeep(targetCampaign);
    res.json(utilityResult);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

router.get('/utility', handleUtility);
router.post('/utility', handleUtility);
router.get('/api/utility', handleUtilityApi);

export default router;
