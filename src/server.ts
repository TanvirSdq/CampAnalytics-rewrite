import express, { Request, Response, NextFunction } from 'express';
import compression from 'compression';
import nunjucks from 'nunjucks';
import path from 'path';
import { fileURLToPath } from 'url';

import { getGlobalContext, getCustomCss, ASSET_VERSION } from './core/context.js';
import healthzRouter from './routes/healthz.js';
import indexRouter from './routes/index.js';
import healthRouter from './routes/health.js';
import influxRouter from './routes/influx.js';
import retentionRouter from './routes/retention.js';
import mobilityRouter from './routes/mobility.js';
import diversityRouter from './routes/diversity.js';
import utilityRouter from './routes/utility.js';
import qualityRouter from './routes/quality.js';
import documentationRouter from './routes/documentation.js';
import comparativeRouter from './routes/comparative.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

const app = express();

// Security Headers Middleware
app.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-XSS-Protection', '0');
  next();
});

// Middleware
app.use(compression() as any);
app.use(express.urlencoded({ extended: true, limit: '100kb' }));
app.use(express.json({ limit: '100kb' }));

// Execution Timing & Memory Profiling Middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = process.hrtime.bigint();
  const origRender = res.render.bind(res);

  res.render = function (view: string, options?: any, callback?: any) {
    let actualOptions = options;
    let actualCallback = callback;
    if (typeof options === 'function') {
      actualCallback = options;
      actualOptions = {};
    }

    const elapsedNs = process.hrtime.bigint() - start;
    const elapsedSec = Number(elapsedNs) / 1e9;
    const executionTimeSec = elapsedSec < 0.001 ? '0.001' : elapsedSec.toFixed(3);
    const executionTimeMs = (Number(elapsedNs) / 1e6).toFixed(1);
    const heapUsedMb = (process.memoryUsage().heapUsed / (1024 * 1024)).toFixed(1);

    if (!res.headersSent) {
      res.setHeader('X-Response-Time', `${executionTimeMs}ms`);
    }

    const mergedOptions = {
      execution_time_sec: executionTimeSec,
      execution_time_ms: executionTimeMs,
      memory_usage_mb: heapUsedMb,
      ...(typeof actualOptions === 'object' && actualOptions !== null ? actualOptions : {})
    };

    return origRender(view, mergedOptions, actualCallback);
  };

  next();
});

// Nunjucks Environment
const isProd = process.env.NODE_ENV === 'production';
const templatesPath = path.join(PROJECT_ROOT, 'templates');
const nunjucksEnv = nunjucks.configure(templatesPath, {
  autoescape: true,
  express: app,
  watch: false,
  noCache: !isProd
});

// XSS-Safe tojson filter: escapes HTML control characters and script terminators
nunjucksEnv.addFilter('tojson', (obj: any) => {
  const json = JSON.stringify(obj === undefined ? null : obj)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  return (nunjucks.runtime as any).markSafe(json);
});

nunjucksEnv.addFilter('format', (fmt: any, val: any) => {
  if (val === undefined || val === null) {
    if (typeof fmt === 'number') {
      return Number.isInteger(fmt) ? fmt.toLocaleString('en-US') : fmt.toFixed(1);
    }
    return '0';
  }
  const n = typeof val === 'number' ? val : parseFloat(val);
  if (isNaN(n)) return String(val);
  if (fmt === '%.1f' || fmt === '%.2f') {
    return n.toFixed(fmt === '%.2f' ? 2 : 1);
  }
  return n.toLocaleString('en-US');
});

nunjucksEnv.addFilter('commas', (val: any) => {
  if (val === undefined || val === null) return '0';
  const n = typeof val === 'number' ? val : parseFloat(val);
  if (isNaN(n)) return String(val);
  return Number.isInteger(n) ? n.toLocaleString('en-US') : n.toFixed(1);
});

nunjucksEnv.addFilter('startswith', (str: any, prefix: string) => {
  return typeof str === 'string' && str.startsWith(prefix);
});

nunjucksEnv.addFilter('endswith', (str: any, suffix: string) => {
  return typeof str === 'string' && str.endsWith(suffix);
});

// Global template locals
app.locals.ASSET_VERSION = ASSET_VERSION;

// Static Assets
const publicPath = path.join(PROJECT_ROOT, 'public');
app.use(express.static(publicPath, {
  maxAge: '1h',
  setHeaders: (res: Response, filePath: string) => {
    if (filePath.endsWith('.css') || filePath.endsWith('.js')) {
      res.setHeader('Cache-Control', 'public, max-age=3600, must-revalidate');
    }
  },
  index: false
}));

// Backward compatibility alias for /styles.css
app.get('/styles.css', (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'public, max-age=3600, must-revalidate');
  res.type('text/css').send(getCustomCss());
});

app.get('/robots.txt', (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.type('text/plain').send('User-agent: *\nAllow: /\n');
});

app.get('/plotly.min.js', (req: Request, res: Response) => {
  res.sendFile(path.join(PROJECT_ROOT, 'node_modules/plotly.js-dist-min/plotly.min.js'));
});

app.get('/og-preview.png', (req: Request, res: Response) => {
  res.sendFile(path.join(PROJECT_ROOT, 'public/images/og-preview.png'));
});

app.get('/favicon.ico', (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'public, max-age=86400, must-revalidate');
  res.sendFile(path.join(PROJECT_ROOT, 'public/favicon.ico'));
});

// Mount Routes
app.use(healthzRouter);
app.use(healthRouter);
app.use(retentionRouter);
app.use(influxRouter);
app.use(mobilityRouter);
app.use(diversityRouter);
app.use(utilityRouter);
app.use(qualityRouter);
app.use(documentationRouter);
app.use(comparativeRouter);

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

// Process Safety: Log and terminate gracefully to allow container orchestrator recovery
process.on('uncaughtException', (err) => {
  console.error('CRITICAL Uncaught Exception - terminating process:', err);
  process.exit(1);
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
