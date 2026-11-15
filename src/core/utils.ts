/**
 * Shared utility functions for CampTools analytics engine and HTTP route handlers.
 */

/**
 * Safely extracts a trimmed scalar string from an Express query/body value,
 * preventing Array/Object type confusion and unhandled TypeError crashes.
 */
export function asScalarString(val: unknown, fallback = ''): string {
  if (typeof val === 'string') return val.trim();
  if (typeof val === 'number' || typeof val === 'boolean') return String(val).trim();
  if (Array.isArray(val) && val.length > 0) {
    return asScalarString(val[0], fallback);
  }
  return fallback;
}

/**
 * Escapes characters for safe inclusion in HTML or SVG text nodes.
 */
export function escapeHtml(str: unknown): string {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Serializes data into JSON safe for embedding inside an inline HTML <script> tag,
 * escaping HTML tags and entities to prevent script injection.
 */
export function safeJsonForScript(val: unknown): string {
  return JSON.stringify(val)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

export function parseCountryList(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map(String).map((c) => c.trim().toLowerCase()).filter(Boolean);
  }
  if (typeof raw === 'string' && raw.trim()) {
    return raw.split(/[,\s]+/).map((c) => c.trim().toLowerCase()).filter(Boolean);
  }
  return [];
}

export function computeEmpiricalMean(arr: number[]): number {
  if (!arr || arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

export function computeEmpiricalMedian(arr: number[]): number | null {
  if (!arr || arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const med = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  return parseFloat(med.toFixed(1));
}

/**
 * Computes smart cache TTL based on whether a campaign code or category
 * refers to a completed historical edition (< current year: 24h) or an
 * active/ongoing current-year edition (15m).
 */
export function getCampaignTtlMs(codeOrCategory: string): number {
  const currentYear = new Date().getFullYear();
  const clean = (codeOrCategory || '').trim().toLowerCase();

  // Check standard campaign code pattern: e.g. wlmde23, allde24
  const codeMatch = /^(?:all|wla|wlf|wle|wlm|wlb)[a-z]{0,2}(\d{2})$/.exec(clean);
  if (codeMatch) {
    const yr = 2000 + parseInt(codeMatch[1], 10);
    return yr < currentYear ? 24 * 60 * 60 * 1000 : 15 * 60 * 1000;
  }

  // Check category year pattern: e.g. Images_from_Wiki_Loves_Monuments_2023_in_Germany
  const catMatch = /\b(20\d{2})\b/.exec(clean);
  if (catMatch) {
    const yr = parseInt(catMatch[1], 10);
    return yr < currentYear ? 24 * 60 * 60 * 1000 : 15 * 60 * 1000;
  }

  return 60 * 60 * 1000; // Default 1 hour
}

/**
 * Bounded concurrency async map to prevent outbound socket/FD exhaustion
 * and respect upstream rate limits (e.g. Wikimedia Commons API).
 */
export async function mapConcurrent<T, R>(
  items: T[],
  concurrencyLimit: number,
  workerFn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];
  const results: R[] = new Array(items.length);
  let currentIndex = 0;
  const poolSize = Math.max(1, Math.min(concurrencyLimit, items.length));

  const workers = Array.from({ length: poolSize }, async () => {
    while (currentIndex < items.length) {
      const idx = currentIndex++;
      results[idx] = await workerFn(items[idx], idx);
    }
  });

  await Promise.all(workers);
  return results;
}

/**
 * Memory-bounded in-memory cache with true LRU eviction and TTL awareness.
 * Prevents monotonically growing heap memory in long-running processes.
 */
export class BoundedCache<K, V> {
  private map = new Map<K, V>();
  private hits = 0;
  private misses = 0;

  constructor(private maxEntries: number = 1000, private defaultTtlMs: number = 3600000) {}

  get(key: K): V | undefined {
    if (!this.map.has(key)) {
      this.misses++;
      return undefined;
    }
    const val = this.map.get(key)!;
    // Refresh key recency for true LRU ordering
    this.map.delete(key);
    this.map.set(key, val);
    this.hits++;
    return val;
  }

  set(key: K, value: V, ttlMs?: number): void {
    if (ttlMs !== undefined && value && typeof value === 'object') {
      (value as any).ttlMs = ttlMs;
    }
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.maxEntries) {
      // Prioritize evicting expired entries if available
      const now = Date.now();
      let evicted = false;
      for (const [k, v] of this.map.entries()) {
        const entryTtl = (v && typeof (v as any).ttlMs === 'number') ? (v as any).ttlMs : this.defaultTtlMs;
        if (v && typeof (v as any).ts === 'number' && now - (v as any).ts >= entryTtl) {
          this.map.delete(k);
          evicted = true;
          break;
        }
      }
      if (!evicted) {
        const oldestKey = this.map.keys().next().value;
        if (oldestKey !== undefined) {
          this.map.delete(oldestKey);
        }
      }
    }
    this.map.set(key, value);
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  delete(key: K): boolean {
    return this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }

  getStats(): { size: number; maxEntries: number; hits: number; misses: number } {
    return {
      size: this.map.size,
      maxEntries: this.maxEntries,
      hits: this.hits,
      misses: this.misses
    };
  }
}

export interface ResolvedCampaignParams {
  eventType: string;
  country: string;
  countryList: string[];
  yrStart: number;
  yrEnd: number;
  metric: string;
  targetCampaign: string;
}

/**
 * Standardized campaign query parameter resolution across analytical modules.
 * Resolves year boundary defaults (e.g., current - 1, start = current - 5),
 * normalizes multi-country input arrays, and eliminates parameter parsing drift.
 */
export function resolveCampaignQueryParams(
  reqDict: Record<string, any>,
  defaultEvent = 'wlm'
): ResolvedCampaignParams {
  const currentYear = new Date().getFullYear();
  const currentY = currentYear - 1;
  const defaultStart = Math.max(2010, currentY - 4);

  const eventType = asScalarString(
    reqDict.event_type ||
      reqDict.eventType ||
      reqDict.influx_event_type ||
      reqDict.quality_event_type ||
      reqDict.utility_event_type ||
      reqDict.retention_event_type,
    defaultEvent
  ).toLowerCase() || defaultEvent;

  const country = asScalarString(
    reqDict.country ||
      reqDict.influx_country ||
      reqDict.quality_country ||
      reqDict.utility_country ||
      reqDict.retention_country ||
      reqDict.country_code
  ).toLowerCase();

  const rawCountries =
    reqDict.countries ||
    reqDict.influx_countries ||
    reqDict.quality_countries ||
    reqDict.utility_countries ||
    reqDict.retention_countries ||
    country;
  const countryList = parseCountryList(rawCountries);

  let yrStart = parseInt(
    asScalarString(
      reqDict.yr_start ||
        reqDict.start_year ||
        reqDict.influx_yr_start ||
        reqDict.retention_yr_start ||
        reqDict.builder_yr_start
    ),
    10
  );
  if (isNaN(yrStart) || yrStart < 2000 || yrStart > currentYear) {
    yrStart = defaultStart;
  }

  let yrEnd = parseInt(
    asScalarString(
      reqDict.yr_end ||
        reqDict.end_year ||
        reqDict.influx_yr_end ||
        reqDict.retention_yr_end ||
        reqDict.builder_yr_end ||
        reqDict.year
    ),
    10
  );
  if (isNaN(yrEnd) || yrEnd < 2000 || yrEnd > currentYear) {
    yrEnd = currentY;
  }

  if (yrStart > yrEnd) {
    const tmp = yrStart;
    yrStart = yrEnd;
    yrEnd = tmp;
  }

  const metric = asScalarString(reqDict.metric || reqDict.metric_key || reqDict.metric_choice || '');
  const targetCampaign = asScalarString(
    reqDict.target_campaign ||
      reqDict.targetCampaign ||
      reqDict.campaign ||
      reqDict.target_campaigns ||
      reqDict.influx_codes ||
      ''
  );

  return {
    eventType,
    country,
    countryList,
    yrStart,
    yrEnd,
    metric,
    targetCampaign
  };
}
