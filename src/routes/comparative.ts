import { Router, Request, Response } from 'express';
import { computeComparativeAnalytics } from '../core/analytics.js';
import { parseCountryList, asScalarString } from '../core/utils.js';

const router = Router();

export async function handleComparativeApi(req: Request, res: Response): Promise<void> {
  const moduleParam = asScalarString(req.query.module, 'influx').trim().toLowerCase();
  if (!['influx', 'retention', 'quality', 'utility', 'diversity', 'mobility'].includes(moduleParam)) {
    res.status(400).json({
      error: `Invalid module '${moduleParam}'. Supported modules: influx, retention, quality, utility, diversity, mobility.`
    });
    return;
  }

  const eventType = asScalarString(req.query.event_type || req.query.eventType, 'wlm').trim().toLowerCase();
  const rawCountries = req.query.countries || req.query.country_codes || req.query.countryCodes;
  const countryCodes = parseCountryList(rawCountries);

  const yrStart = parseInt(asScalarString(req.query.start_year || req.query.startYear || req.query.yr_start), 10);
  const yrEnd = parseInt(asScalarString(req.query.end_year || req.query.endYear || req.query.yr_end), 10);
  const metricKey = asScalarString(req.query.metric || req.query.metric_key || req.query.metricKey).trim();
  const format = asScalarString(req.query.format).trim().toLowerCase();

  try {
    const result = await computeComparativeAnalytics({
      module: moduleParam as 'influx' | 'retention' | 'quality' | 'utility' | 'diversity' | 'mobility',
      eventType,
      countryCodes,
      startYear: yrStart,
      endYear: yrEnd,
      metricKey: metricKey || undefined
    });

    if (format === 'csv') {
      const dateSlug = new Date().toISOString().slice(0, 10);
      const filename = `camptools_comparative_${moduleParam}_${eventType}_${dateSlug}.csv`;
      const csvLines: string[] = [
        '# Tool: CampTools (https://camptools.toolforge.org/)',
        `# Module: ${result.indicator_title} (${result.event_name})`,
        `# Unit: ${result.indicator_unit}`,
        `# Export Date: ${new Date().toISOString()}`,
        '# License: GPL-2.0-or-later / Data: CC BY-SA 4.0',
        result.table_data.headers.map((h) => `"${String(h).replace(/"/g, '""')}"`).join(',')
      ];

      for (const row of result.table_data.rows) {
        const cells: string[] = [`${row.country_name} (${row.country_code.toUpperCase()})`];
        for (const yr of result.years) {
          const val = row.values[yr] !== undefined && row.values[yr] !== null ? String(row.values[yr]) : '';
          cells.push(val);
        }
        cells.push(row.latest !== null && row.latest !== undefined ? String(row.latest) : '');
        cells.push(row.average !== null && row.average !== undefined ? String(row.average) : '');
        cells.push(row.yoy_change_formatted || (row.yoy_change !== null ? `${row.yoy_change}%` : ''));
        csvLines.push(cells.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','));
      }

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.status(200).send(csvLines.join('\n'));
      return;
    }

    if (format === 'json' && asScalarString(req.query.download) === '1') {
      const dateSlug = new Date().toISOString().slice(0, 10);
      const filename = `camptools_comparative_${moduleParam}_${eventType}_${dateSlug}.json`;
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    }

    res.json(result);
  } catch (err: any) {
    console.error('Comparative API error:', err);
    res.status(500).json({ error: 'An internal error occurred while processing the comparative request.' });
  }
}

router.get('/api/comparative', handleComparativeApi);

export default router;
