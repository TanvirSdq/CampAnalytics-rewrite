import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Request } from 'express';
import * as analytics from './analytics.js';
import { GlobalContext } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function makeDict<T extends Record<string, any>>(obj: T): T {
  const d = { ...obj };
  Object.defineProperty(d, 'items', {
    value: function () { return Object.entries(this); },
    enumerable: false,
    configurable: true
  });
  Object.defineProperty(d, 'keys', {
    value: function () { return Object.keys(this); },
    enumerable: false,
    configurable: true
  });
  Object.defineProperty(d, 'values', {
    value: function () { return Object.values(this); },
    enumerable: false,
    configurable: true
  });
  return d;
}

// Polyfill Jinja compatibility methods on String prototype
(String.prototype as any).format = function (...args: any[]) {
  const str = this.toString();
  if (str === '{:,}' || str.includes('{:,}')) {
    const val = Number(args[0]);
    return isNaN(val) ? String(args[0] ?? 0) : val.toLocaleString();
  }
  if (str.startsWith('%.') && str.endsWith('f')) {
    const digits = parseInt(str.slice(2, -1), 10) || 1;
    const val = Number(args[0]);
    return isNaN(val) ? String(args[0] ?? 0) : val.toFixed(digits);
  }
  return String(args[0] ?? '');
};

(String.prototype as any).startswith = function (prefix: string) {
  return this.startsWith(prefix);
};

(String.prototype as any).endswith = function (suffix: string) {
  return this.endsWith(suffix);
};

let cachedCss = '';
export function getCustomCss(): string {
  if (cachedCss) return cachedCss;
  try {
    const p = path.resolve(__dirname, '../../public/css/styles.css');
    cachedCss = fs.readFileSync(p, 'utf-8');
  } catch {
    try {
      const fallback = path.resolve(__dirname, '../../styles.css');
      cachedCss = fs.readFileSync(fallback, 'utf-8');
    } catch {
      cachedCss = '';
    }
  }
  return cachedCss;
}

export function getGlobalContext(req: Request): GlobalContext {
  const currentYear = new Date().getFullYear();
  return {
    PAGE_TITLE: 'CampTools - Event Evaluation',
    PAGE_ICON: '📊',
    KORIKATH_LOGO_URL: 'https://upload.wikimedia.org/wikipedia/commons/9/99/Project_Korikath_Logo-dark.svg',
    EVENT_MAP: makeDict(analytics.EVENT_MAP),
    EVENT_DISPLAY_MAP: analytics.EVENT_DISPLAY_MAP,
    EVENT_COUNTRY_SCOPE: analytics.EVENT_COUNTRY_SCOPE,
    COUNTRY_OPTIONS: analytics.COUNTRY_OPTIONS,
    COUNTRY_MAP: analytics.COUNTRY_MAP,
    REGION_COUNTRY_MAPPING: makeDict(analytics.REGION_COUNTRY_MAPPING),
    COUNTRY_TO_REGION: analytics.COUNTRY_TO_REGION,
    EXAMPLE_CODES: analytics.EXAMPLE_CODES,
    CUSTOM_CSS: getCustomCss(),
    TEXT_MUTED: '#54595d',
    CURRENT_YEAR: currentYear,
    DEFAULT_START_YEAR: currentYear - 4,
    request: {
      path: req.path,
      query: req.query
    }
  };
}
