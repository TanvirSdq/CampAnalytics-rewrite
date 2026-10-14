import express, { Request, Response, NextFunction } from 'express';
import compression from 'compression';
import nunjucks from 'nunjucks';
import path from 'path';
import { fileURLToPath } from 'url';

import { getGlobalContext, getCustomCss } from './core/context.js';
import { computeComparativeAnalytics } from './core/analytics.js';
import healthzRouter from './routes/healthz.js';
import indexRouter from './routes/index.js';
import healthRouter from './routes/health.js';
import influxRouter from './routes/influx.js';
import retentionRouter from './routes/retention.js';
import utilityRouter from './routes/utility.js';
import qualityRouter from './routes/quality.js';
import documentationRouter from './routes/documentation.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

const app = express();

// Middleware
app.use(compression() as any);
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));

// Execution Timing & Memory Profiling Middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = process.hrtime.bigint();
  const origRender = res.render.bind(res);

  res.render = function (view: string, options?: any, callback?: any) {
    const elapsedNs = process.hrtime.bigint() - start;
    const elapsedSec = Number(elapsedNs) / 1e9;
    const executionTimeSec = elapsedSec < 0.001 ? '0.001' : elapsedSec.toFixed(3);
    const executionTimeMs = (Number(elapsedNs) / 1e6).toFixed(1);
    const heapUsedMb = (process.memoryUsage().heapUsed / (1024 * 1024)).toFixed(1);

    res.setHeader('X-Response-Time', `${executionTimeMs}ms`);

    const mergedOptions = {
      execution_time_sec: executionTimeSec,
      execution_time_ms: executionTimeMs,
      memory_usage_mb: heapUsedMb,
      ...(typeof options === 'object' && options !== null ? options : {})
    };

    return origRender(view, mergedOptions, callback);
  };

  next();
});

// Nunjucks Environment
const templatesPath = path.join(PROJECT_ROOT, 'templates');
const nunjucksEnv = nunjucks.configure(templatesPath, {
  autoescape: true,
  express: app,
  watch: false,
  noCache: true
});

nunjucksEnv.addFilter('tojson', (obj: any) => {
  return (nunjucks.runtime as any).markSafe(JSON.stringify(obj === undefined ? null : obj));
});

nunjucksEnv.addFilter('format', (fmt: any, val: any) => {
  if (val === undefined || val === null) {
    if (typeof fmt === 'number') return fmt.toFixed(1);
    return '0.0';
  }
  const n = typeof val === 'number' ? val : parseFloat(val);
  if (isNaN(n)) return String(val);
  if (fmt === '%.1f' || fmt === '%.2f') {
    return n.toFixed(fmt === '%.2f' ? 2 : 1);
  }
  return n.toLocaleString();
});

// Static Assets
const publicPath = path.join(PROJECT_ROOT, 'public');
app.use(express.static(publicPath, { maxAge: '1d', index: false }));

// Backward compatibility alias for /styles.css
app.get('/styles.css', (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.type('text/css').send(getCustomCss());
});

app.get('/robots.txt', (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.type('text/plain').send('User-agent: *\nAllow: /\n');
});

app.get('/plotly.min.js', (req: Request, res: Response) => {
  res.sendFile(path.join(PROJECT_ROOT, 'node_modules/plotly.js-dist-min/plotly.min.js'));
});

// Mount Routes
app.use(healthzRouter);
app.use(healthRouter);
app.use(influxRouter);
app.use(retentionRouter);
app.use(utilityRouter);
app.use(qualityRouter);
app.use(documentationRouter);

// Unified Comparative Analytics API
app.get('/api/comparative', async (req: Request, res: Response) => {
  const moduleParam = ((req.query.module || 'influx') as string).trim().toLowerCase();
  if (!['influx', 'retention', 'quality', 'utility'].includes(moduleParam)) {
    res.status(400).json({
      error: `Invalid module '${moduleParam}'. Supported modules: influx, retention, quality, utility.`
    });
    return;
  }

  const eventType = ((req.query.event_type || req.query.eventType) as string || 'wlm').trim().toLowerCase();
  const rawCountries = req.query.countries || req.query.country_codes || req.query.countryCodes;
  let countryCodes: string[] = [];
  if (Array.isArray(rawCountries)) {
    countryCodes = rawCountries.map(String).map((c) => c.trim().toLowerCase()).filter(Boolean);
  } else if (typeof rawCountries === 'string' && rawCountries.trim()) {
    countryCodes = rawCountries.split(/[,\s]+/).map((c) => c.trim().toLowerCase()).filter(Boolean);
  }

  const yrStart = parseInt((req.query.start_year || req.query.startYear || req.query.yr_start) as string, 10);
  const yrEnd = parseInt((req.query.end_year || req.query.endYear || req.query.yr_end) as string, 10);
  const metricKey = ((req.query.metric || req.query.metric_key || req.query.metricKey) as string || '').trim();

  try {
    const result = await computeComparativeAnalytics({
      module: moduleParam as 'influx' | 'retention' | 'quality' | 'utility',
      eventType,
      countryCodes,
      startYear: yrStart,
      endYear: yrEnd,
      metricKey: metricKey || undefined
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.use(indexRouter); // Mounted last to allow root handler and fallbacks

// 404 Handler
app.use((req: Request, res: Response) => {
  res.status(404).render('home.html', {
    ...getGlobalContext(req),
    PAGE_TITLE: 'CampTools — Not Found',
    mode: 'Tools',
    error: 'The requested page or endpoint could not be found (HTTP 404). Please select a tool from the suite below.'
  });
});

// 500 Error Handler
app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
  console.error('Express server error:', err);
  res.status(500).render('home.html', {
    ...getGlobalContext(req),
    PAGE_TITLE: 'CampTools — Internal Server Error',
    mode: 'Tools',
    error: 'An internal server error occurred (HTTP 500). Please verify your campaign parameters or retry.'
  });
});

// Process Safety
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Server Listen
const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`CampTools server listening on http://${HOST}:${PORT}`);
});

export default app;
