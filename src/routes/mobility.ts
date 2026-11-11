import { Router, Request, Response } from 'express';
import { getGlobalContext } from '../core/context.js';
import * as analytics from '../core/analytics.js';
import { asScalarString } from '../core/utils.js';

const router = Router();

export async function handleMobility(req: Request, res: Response): Promise<void> {
  const reqDict = req.method === 'POST' ? req.body : req.query;
  const currentYear = new Date().getFullYear();
  const currentY = currentYear - 1;

  const country = asScalarString(reqDict.mobility_country || reqDict.country).trim().toLowerCase();
  const year = parseInt(asScalarString(reqDict.mobility_year || reqDict.year), 10) || currentY;

  let eventList: string[] = [];
  const rawEvents = reqDict.mobility_events || reqDict.events;
  if (Array.isArray(rawEvents)) {
    eventList = rawEvents.map(String).map((e) => e.trim().toLowerCase()).filter(Boolean);
  } else if (typeof rawEvents === 'string' && rawEvents.trim()) {
    eventList = rawEvents.split(/[,\s]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
  }

  if (req.method === 'GET' && Object.keys(req.query).length === 0 && !country) {
    res.render('mobility.html', {
      ...getGlobalContext(req),
      PAGE_TITLE: 'CampTools - Contributor Mobility',
      mode: 'Mobility',
      mobility_country: '',
      mobility_year: currentY,
      mobility_events: ['wlm', 'wle', 'wlf'],
      mobility_result: null,
      error: null
    });
    return;
  }

  try {
    const result = await analytics.computeMobilityAnalytics({
      year,
      countryCode: country || 'de',
      events: eventList.length > 0 ? eventList : undefined
    });

    res.render('mobility.html', {
      ...getGlobalContext(req),
      PAGE_TITLE: 'CampTools - Contributor Mobility',
      mode: 'Mobility',
      mobility_country: country || 'de',
      mobility_year: year,
      mobility_events: result.events,
      mobility_result: result,
      error: null
    });
  } catch (err: any) {
    res.render('mobility.html', {
      ...getGlobalContext(req),
      PAGE_TITLE: 'CampTools - Contributor Mobility',
      mode: 'Mobility',
      mobility_country: country,
      mobility_year: year,
      mobility_events: eventList,
      mobility_result: null,
      error: err.message
    });
  }
}

export async function handleMobilityApi(req: Request, res: Response): Promise<void> {
  const country = asScalarString(req.query.mobility_country || req.query.country, 'de').trim().toLowerCase();
  const currentY = new Date().getFullYear() - 1;
  const year = parseInt(asScalarString(req.query.mobility_year || req.query.year), 10) || currentY;

  let eventList: string[] = [];
  const rawEvents = req.query.mobility_events || req.query.events;
  if (Array.isArray(rawEvents)) {
    eventList = rawEvents.map(String).map((e) => e.trim().toLowerCase()).filter(Boolean);
  } else if (typeof rawEvents === 'string' && rawEvents.trim()) {
    eventList = rawEvents.split(/[,\s]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
  }

  try {
    const result = await analytics.computeMobilityAnalytics({
      year,
      countryCode: country,
      events: eventList.length > 0 ? eventList : undefined
    });
    res.json(result);
  } catch (err: any) {
    console.error('Mobility API error:', err);
    res.status(500).json({ error: 'An internal error occurred while evaluating contributor mobility.' });
  }
}

router.get('/mobility', handleMobility);
router.post('/mobility', handleMobility);
router.get('/api/mobility', handleMobilityApi);

export default router;
