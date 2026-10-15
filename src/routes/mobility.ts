import { Router, Request, Response } from 'express';
import { getGlobalContext } from '../core/context.js';
import * as analytics from '../core/analytics.js';

const router = Router();

export async function handleMobility(req: Request, res: Response): Promise<void> {
  const reqDict = req.method === 'POST' ? req.body : req.query;
  const currentYear = new Date().getFullYear();
  const currentY = currentYear - 1;

  const country = ((reqDict.mobility_country || reqDict.country) as string || '').trim().toLowerCase();
  const year = parseInt((reqDict.mobility_year || reqDict.year) as string, 10) || currentY;

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

router.get('/mobility', handleMobility);
router.post('/mobility', handleMobility);

export default router;
