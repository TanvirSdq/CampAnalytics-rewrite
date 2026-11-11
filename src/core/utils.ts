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
 * Memory-bounded in-memory cache with FIFO eviction.
 * Prevents monotonically growing heap memory in long-running processes.
 */
export class BoundedCache<K, V> {
  private map = new Map<K, V>();

  constructor(private maxEntries: number = 1000) {}

  get(key: K): V | undefined {
    return this.map.get(key);
  }

  set(key: K, value: V): void {
    if (this.map.size >= this.maxEntries && !this.map.has(key)) {
      // Prioritize evicting expired entries if available
      const now = Date.now();
      let evicted = false;
      for (const [k, v] of this.map.entries()) {
        if (v && typeof (v as any).ts === 'number' && now - (v as any).ts >= 3600000) {
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
