import { Router, Request, Response } from 'express';
import { getGlobalContext } from '../core/context.js';
import * as analytics from '../core/analytics.js';

const router = Router();

export async function handleRetention(req: Request, res: Response): Promise<void> {
  const reqDict = req.method === 'POST' ? req.body : req.query;
  const currentYear = new Date().getFullYear();
  let targetCampaigns = ((reqDict.target_campaigns as string) || '').trim();
  const viewMode = (reqDict.view_mode as string) || 'Both';
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

  if (req.method === 'GET' && Object.keys(req.query).length === 0 && !targetCampaigns) {
    res.render('retention.html', {
      ...getGlobalContext(req),
      PAGE_TITLE: 'CampTools - Contributor Retention',
      mode: 'Retention Analytics',
      target_campaigns: '',
      view_mode: 'Both',
      metric_choice: 'Average',
      error: null,
      tables: [],
      heatmaps: [],
      worldmap_html: '',
      total_heatmaps_count: 0,
      remaining_heatmaps_count: 0
    });
    return;
  }

  if (!targetCampaigns) {
    res.render('retention.html', {
      ...getGlobalContext(req),
      PAGE_TITLE: 'CampTools - Contributor Retention',
      mode: 'Retention Analytics',
      target_campaigns: '',
      view_mode: viewMode,
      metric_choice: metricChoice,
      error: null,
      tables: [],
      heatmaps: [],
      worldmap_html: '',
      total_heatmaps_count: 0,
      remaining_heatmaps_count: 0
    });
    return;
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
        error = scopeNotices.length > 0 ? scopeNotices.join(' ') : 'No comparative vectors resolved. Verify that at least two overlapping temporal editions exist for your selected countries.';
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

  res.render('retention.html', {
    ...getGlobalContext(req),
    PAGE_TITLE: 'CampTools - Retention Analysis Dashboard',
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

export async function handleRetentionApi(req: Request, res: Response): Promise<void> {
  const targetCampaigns = ((req.query.target_campaigns as string) || '').trim();
  if (!targetCampaigns) {
    res.status(400).json({ error: 'Missing target_campaigns parameter' });
    return;
  }
  const rawCodes = targetCampaigns.split(/\s+/).filter(Boolean);
  const valid = rawCodes.map((c) => c.replace(/\s+/g, '').toLowerCase()).filter((c) => analytics.CODE_RE.test(c));
  if (!valid.length) {
    res.status(400).json({ error: 'No valid campaign codes found' });
    return;
  }
  try {
    const participantResults = await analytics.fetchAllConcurrently(valid);
    const matrix = analytics.computeRetentionPercentages(participantResults);
    res.json({ target_campaigns: valid, matrix });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function handleHeatmapsApi(req: Request, res: Response): Promise<void> {
  const targetCampaigns = ((req.query.target_campaigns as string) || '').trim();
  const offset = Math.max(0, parseInt(req.query.offset as string, 10) || 6);
  const limit = Math.max(1, Math.min(24, parseInt(req.query.limit as string, 10) || 6));

  if (!targetCampaigns) {
    res.status(400).json({ error: 'Missing target_campaigns parameter', heatmaps: [] });
    return;
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
    res.status(400).json({ error: 'No valid campaign codes found', heatmaps: [] });
    return;
  }

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
  } catch (err: any) {
    res.status(500).json({ error: err.message, heatmaps: [] });
  }
}

router.get('/retention', handleRetention);
router.post('/retention', handleRetention);
router.get('/api/retention', handleRetentionApi);
router.get('/api/retention/heatmaps', handleHeatmapsApi);

export default router;
