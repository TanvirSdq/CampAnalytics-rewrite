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

export const ASSET_VERSION = `${Date.now().toString(36)}`;

// Pre-wrap static dictionaries once to eliminate per-request Object.defineProperty overhead
const WRAPPED_EVENT_MAP = makeDict(analytics.EVENT_MAP);
const WRAPPED_REGION_MAPPING = makeDict(analytics.REGION_COUNTRY_MAPPING);

export function getGlobalContext(req: Request): GlobalContext {
  const currentYear = new Date().getFullYear();
  return {
    PAGE_TITLE: 'CampTools - Event Evaluation',
    PAGE_ICON: '📊',
    KORIKATH_LOGO_URL: 'https://upload.wikimedia.org/wikipedia/commons/7/7c/Project_Korikath_Logo.svg',
    EVENT_MAP: WRAPPED_EVENT_MAP,
    EVENT_DISPLAY_MAP: analytics.EVENT_DISPLAY_MAP,
    EVENT_COUNTRY_SCOPE: analytics.EVENT_COUNTRY_SCOPE,
    COUNTRY_OPTIONS: analytics.COUNTRY_OPTIONS,
    COUNTRY_MAP: analytics.COUNTRY_MAP,
    REGION_COUNTRY_MAPPING: WRAPPED_REGION_MAPPING,
    COUNTRY_TO_REGION: analytics.COUNTRY_TO_REGION,
    EXAMPLE_CODES: analytics.EXAMPLE_CODES,
    CUSTOM_CSS: getCustomCss(),
    TEXT_MUTED: '#54595d',
    CURRENT_YEAR: currentYear,
    DEFAULT_START_YEAR: currentYear - 4,
    ASSET_VERSION,
    request: {
      path: req.path,
      query: req.query
    }
  };
}
