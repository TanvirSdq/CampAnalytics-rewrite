import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  HealthBenchmarks,
  HealthEvaluationResult,
  HistoricalEditionPoint,
  PeerComparisonPoint,
  OverallCampaignReport,
  TimeSeriesPoint,
  CountrySeries,
  ComparativeTableRow,
  MapTimelinePoint,
  IndicatorMetadata,
  ComparativeAnalyticsResult,
  ComparativeParams,
  MobilityMatrixCell,
  MobilityMatrixRow,
  MobilityResult,
  SankeyNode,
  SankeyLink,
  EcosystemFlowData,
  ContributorTierBreakdown,
  DiversityRecord,
  DiversityResult
} from './types.js';

import { BoundedCache, mapConcurrent, computeEmpiricalMean } from './utils.js';

export type {
  HealthEvaluationResult,
  HistoricalEditionPoint,
  PeerComparisonPoint,
  OverallCampaignReport,
  TimeSeriesPoint,
  CountrySeries,
  ComparativeTableRow,
  MapTimelinePoint,
  IndicatorMetadata,
  ComparativeAnalyticsResult,
  ComparativeParams,
  MobilityMatrixCell,
  MobilityMatrixRow,
  MobilityResult,
  SankeyNode,
  SankeyLink,
  EcosystemFlowData,
  ContributorTierBreakdown,
  DiversityRecord,
  DiversityResult
};

export const CODEX_COLOR_PALETTE: string[] = [
  '#3366cc', // Codex Progressive Blue
  '#d73333', // Codex Destructive Red
  '#00af89', // Codex Success Green
  '#ac6600', // Codex Warning Amber
  '#6b4ba1', // Codex Royal Purple
  '#008080', // Codex Deep Teal
  '#e67300', // Codex Vivid Orange
  '#54595d', // Codex Base Muted Slate
  '#4c34a4', // Codex Indigo
  '#0097a7', // Codex Cyan
  '#b32424', // Codex Crimson
  '#14866d', // Codex Pine Green
  '#2a4b8d', // Codex Navy
  '#7232e8', // Codex Bright Violet
  '#8c5e00'  // Codex Brown
];

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load config.json
const configPath = path.resolve(__dirname, '../../config.json');
const rawConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

export const EVENT_MAP: Record<string, string> = rawConfig.EVENT_MAP;
export const EVENT_DISPLAY_MAP: Record<string, string> = rawConfig.EVENT_DISPLAY_MAP || {};
export const EVENT_COUNTRY_SCOPE: Record<string, any> = rawConfig.EVENT_COUNTRY_SCOPE || {};
export const COUNTRY_MAP: Record<string, string> = rawConfig.COUNTRY_MAP;
export const REGION_COUNTRY_MAPPING: Record<string, string[]> = rawConfig.REGION_COUNTRY_MAPPING;
export const COUNTRIES_WITH_THE = new Set<string>(rawConfig.COUNTRIES_WITH_THE || ['cz', 'nl', 'ph', 'uk', 'us']);
export const KNOWN_BOTS = new Set<string>(rawConfig.KNOWN_BOTS || [
  'Flickr upload bot',
  'File Upload Bot (Magnus Manske)',
  'CommonsDelinker',
  'WLM-Bot',
  'Cropbot',
  'Rotbot',
  'FlickrLickr',
  'Wiki Loves Earth Bot',
  'UploadWizard'
]);

export const BOT_REGEX = /(?:bot|_bot|-bot|\s+bot)$/i;
export const CODE_RE = /^(all|wla|wlf|wle|wlm|wlb)([a-z]{0,2})(\d{2})$/;
export const EXAMPLE_CODES = 'wlmde21 wlmde22 wlmbd22 wlmbd23';
export const COUNTRY_OPTIONS = Object.keys(COUNTRY_MAP).sort((a, b) =>
  COUNTRY_MAP[a].localeCompare(COUNTRY_MAP[b])
);

export const COUNTRY_TO_REGION: Record<string, string> = {};
for (const [regName, ccs] of Object.entries(REGION_COUNTRY_MAPPING)) {
  for (const cc of ccs) {
    COUNTRY_TO_REGION[cc] = regName;
  }
}

export function countryDisplayName(cc: string): string {
  return (COUNTRY_MAP[cc] || cc).replace(/_/g, ' ');
}

export function isBotAccount(username: string): boolean {
  if (!username) return true;
  const u = username.trim();
  if (KNOWN_BOTS.has(u)) return true;
  if (/bot$/i.test(u) || /_bot$/i.test(u) || /-bot$/i.test(u)) return true;
  return false;
}

export function getCampaignScopeNotice(event: string, countryCode?: string): string | null {
  if (!event || event === 'all') return null;
  const scope = EVENT_COUNTRY_SCOPE[event] || '*';
  if (scope === '*') return null;

  const countryName = (countryCode ? (COUNTRY_MAP[countryCode] || countryCode.toUpperCase()) : 'this region').replace(/_/g, ' ');

  if (event === 'wlb') {
    const allowed = Array.isArray(scope.countries) ? scope.countries : ['bd', 'in'];
    if (countryCode && !allowed.includes(countryCode)) {
      return `Wiki Loves Bangla is a linguistic and cultural campaign dedicated to the global Bengali community (primarily Bangladesh and India). It does not hold separate national editions in ${countryName}.`;
    }
  } else if (event === 'wla') {
    const allowed = Array.isArray(scope) ? scope : [];
    if (countryCode && !allowed.includes(countryCode)) {
      return `Wiki Loves Africa is a continental initiative organized exclusively within African nations. It does not operate national competitions in ${countryName}.`;
    }
  } else if (Array.isArray(scope) && countryCode && !scope.includes(countryCode)) {
    const eventTitle = EVENT_MAP[event] || event.toUpperCase();
    return `Wiki Loves ${eventTitle} does not operate official editions in ${countryName}.`;
  }
  return null;
}

export function isEventScopedForCountry(event: string, countryCode?: string): boolean {
  if (!countryCode || countryCode === 'all') return true;
  return getCampaignScopeNotice(event, countryCode) === null;
}

export function codeToCategory(code: string): string | null {
  const codeClean = code.replace(/\s+/g, '').toLowerCase();
  const match = CODE_RE.exec(codeClean);
  if (!match) return null;
  const [, event, cc, yr] = match;
  if (event === 'all') return null;
  const eventName = EVENT_MAP[event];
  if (!eventName) return null;

  const catEvent = eventName.replace(/\s+/g, '_');
  let category = `Images_from_Wiki_Loves_${catEvent}_${2000 + parseInt(yr, 10)}`;
  const eventScope = EVENT_COUNTRY_SCOPE[event] || '*';
  const countryless = typeof eventScope === 'object' && eventScope.no_country_suffix;

  if (cc && !countryless) {
    const countryLabel = COUNTRY_MAP[cc];
    if (!countryLabel) return null;
    if (COUNTRIES_WITH_THE.has(cc)) {
      category += `_in_the_${countryLabel}`;
    } else {
      category += `_in_${countryLabel}`;
    }
  }
  return category;
}

export function getCategoryCandidates(code: string): string[] {
  const primary = codeToCategory(code);
  if (!primary) return [];
  const candidates = [primary];
  const codeClean = code.replace(/\s+/g, '').toLowerCase();
  const match = CODE_RE.exec(codeClean);
  if (match) {
    const [, event, cc, yr] = match;
    const eventScope = EVENT_COUNTRY_SCOPE[event] || '*';
    const countryless = typeof eventScope === 'object' && eventScope.no_country_suffix;
    if (cc && !countryless) {
      const countryLabel = COUNTRY_MAP[cc];
      if (countryLabel) {
        const eventName = EVENT_MAP[event] || event;
        const catEvent = eventName.replace(/\s+/g, '_');
        const base = `Images_from_Wiki_Loves_${catEvent}_${2000 + parseInt(yr, 10)}`;
        const alt = COUNTRIES_WITH_THE.has(cc) ? `${base}_in_${countryLabel}` : `${base}_in_the_${countryLabel}`;
        if (!candidates.includes(alt)) {
          candidates.push(alt);
        }
      }
    }
  }
  return candidates;
}

export function getSubCampaignCodes(code: string): string[] {
  const clean = code.replace(/\s+/g, '').toLowerCase();
  const match = CODE_RE.exec(clean);
  if (!match) return [];
  const [, event, cc, yr] = match;
  if (event !== 'all') return [clean];
  const subCodes: string[] = [];
  for (const e of Object.keys(EVENT_MAP)) {
    const scope = EVENT_COUNTRY_SCOPE[e] || '*';
    if (typeof scope === 'object' && scope.countries) {
      if (scope.countries.includes(cc)) {
        subCodes.push(scope.no_country_suffix ? `${e}${yr}` : `${e}${cc}${yr}`);
      }
    } else if (scope === '*' || (Array.isArray(scope) && scope.includes(cc))) {
      subCodes.push(`${e}${cc}${yr}`);
    }
  }
  return subCodes;
}


// In-Memory Participant & Metrics Cache (Bounded to prevent memory leaks)
const _participantCache = new BoundedCache<string, { users: Set<string>; ts: number }>(1000);
const _userCountsCache = new BoundedCache<string, { counts: Map<string, number>; ts: number }>(1000);
const _metricsCache = new BoundedCache<string, { data: any; ts: number }>(1000);
const _categoryFileCountCache = new BoundedCache<string, { count: number; ts: number }>(2000);
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export async function fetchCategoryFileCount(category: string): Promise<number> {
  const norm = category.replace(/\s+/g, '_').toLowerCase();
  const cached = _categoryFileCountCache.get(norm);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.count;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const catTitle = category.startsWith('Category:') ? category : `Category:${category}`;
    const url = `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(catTitle)}&prop=categoryinfo&format=json`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'CampTools/1.0 (https://camptools.toolforge.org; tanvirsdq@toolforge.org)' },
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (res.ok) {
      const data = await res.json();
      const pages = data?.query?.pages || {};
      for (const pid of Object.keys(pages)) {
        const cinfo = pages[pid]?.categoryinfo;
        if (cinfo && typeof cinfo.files === 'number') {
          _categoryFileCountCache.set(norm, { count: cinfo.files, ts: Date.now() });
          return cinfo.files;
        }
      }
    }
  } catch {
    // Network fallback
  }

  _categoryFileCountCache.set(norm, { count: 0, ts: Date.now() });
  return 0;
}


export async function fetchParticipantsForCategory(category: string): Promise<Set<string>> {
  const users = new Set<string>();
  const counts = new Map<string, number>();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    // Try Toolforge uploadersincat scraper first
    const ptoolsUrl = `https://ptools.toolforge.org/uploadersincat.php?category=${encodeURIComponent(category)}`;
    const res = await fetch(ptoolsUrl, {
      headers: { 'User-Agent': 'CampTools/1.0 (https://camptools.toolforge.org)' },
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (res.ok) {
      const html = await res.text();
      const regex = /User:([^"'<>#]+)<\/a>\s*:\s*(\d+)\s*files/g;
      let match;
      while ((match = regex.exec(html)) !== null) {
        const username = match[1].trim();
        const fileCount = parseInt(match[2], 10);
        if (!isBotAccount(username)) {
          users.add(username);
          if (!isNaN(fileCount)) {
            counts.set(username, fileCount);
          }
        }
      }
      if (users.size > 0) {
        _userCountsCache.set(category.toLowerCase(), { counts, ts: Date.now() });
        return users;
      }
    }
  } catch {
    // Network or timeout failure, continue to Commons API
  }

  try {
    let continueToken: string | undefined = undefined;
    let iterations = 0;
    while (iterations < 10) {
      iterations++;
      const continueParam: string = continueToken ? `&gcmcontinue=${encodeURIComponent(continueToken)}` : '';
      const commonsUrl: string = `https://commons.wikimedia.org/w/api.php?action=query&generator=categorymembers&gcmtitle=Category:${encodeURIComponent(category)}&gcmlimit=500&prop=imageinfo&iiprop=user&format=json${continueParam}`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);
      const res: Response = await fetch(commonsUrl, {
        headers: { 'User-Agent': 'CampTools/1.0 (https://camptools.toolforge.org; tanvirsdq@toolforge.org)' },
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (!res.ok) break;
      const data: any = await res.json();
      const pages = data?.query?.pages || {};
      for (const pageId of Object.keys(pages)) {
        const ii = pages[pageId]?.imageinfo;
        if (ii && ii[0]?.user) {
          const u = ii[0].user;
          if (!isBotAccount(u)) {
            users.add(u);
            counts.set(u, (counts.get(u) || 0) + 1);
          }
        }
      }
      if (data?.continue?.gcmcontinue) {
        continueToken = data.continue.gcmcontinue;
      } else {
        break;
      }
    }
    if (users.size > 0) {
      _userCountsCache.set(category.toLowerCase(), { counts, ts: Date.now() });
      return users;
    }
  } catch {
    // Fall through
  }

  return users;
}

export async function getParticipants(code: string): Promise<Set<string>> {
  const clean = code.replace(/\s+/g, '').toLowerCase();
  const cached = _participantCache.get(clean);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.users;
  }

  const match = CODE_RE.exec(clean);
  if (!match) return new Set<string>();

  const [_, event, cc, yr] = match;
  if (event === 'all') {
    // Aggregate across campaigns
    const subCodes = getSubCampaignCodes(clean);
    const subResults = await fetchAllConcurrently(subCodes);
    const combined = new Set<string>();
    for (const s of Object.values(subResults)) {
      for (const u of s) combined.add(u);
    }
    _participantCache.set(clean, { users: combined, ts: Date.now() });
    return combined;
  }

  const categories = getCategoryCandidates(clean);
  for (const cat of categories) {
    const fetched = await fetchParticipantsForCategory(cat);
    if (fetched.size > 0) {
      _participantCache.set(clean, { users: fetched, ts: Date.now() });
      return fetched;
    }
  }

  // Strict empirical reporting: return empty set if campaign did not take place or has no recorded uploads
  const emptyUsers = new Set<string>();
  _participantCache.set(clean, { users: emptyUsers, ts: Date.now() });
  return emptyUsers;
}

export async function getParticipantsWithUploadCounts(code: string): Promise<Map<string, number>> {
  const clean = code.replace(/\s+/g, '').toLowerCase();
  const cached = _userCountsCache.get(clean);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.counts;
  }

  const match = CODE_RE.exec(clean);
  if (!match) return new Map<string, number>();

  const [_, event, cc, yr] = match;
  if (event === 'all') {
    const subCodes = getSubCampaignCodes(clean);
    const combinedCounts = new Map<string, number>();
    for (const sub of subCodes) {
      const subCounts = await getParticipantsWithUploadCounts(sub);
      for (const [u, cnt] of subCounts.entries()) {
        combinedCounts.set(u, (combinedCounts.get(u) || 0) + cnt);
      }
    }
    _userCountsCache.set(clean, { counts: combinedCounts, ts: Date.now() });
    return combinedCounts;
  }

  const categories = getCategoryCandidates(clean);
  for (const cat of categories) {
    const catCached = _userCountsCache.get(cat.toLowerCase());
    if (catCached && catCached.counts.size > 0) {
      _userCountsCache.set(clean, { counts: catCached.counts, ts: Date.now() });
      return catCached.counts;
    }
    const fetched = await fetchParticipantsForCategory(cat);
    if (fetched.size > 0) {
      const afterFetch = _userCountsCache.get(cat.toLowerCase());
      if (afterFetch && afterFetch.counts.size > 0) {
        _userCountsCache.set(clean, { counts: afterFetch.counts, ts: Date.now() });
        return afterFetch.counts;
      }
    }
  }

  // Strict empirical reporting: return empty map if campaign did not take place or has no recorded uploads
  const emptyCounts = new Map<string, number>();
  _userCountsCache.set(clean, { counts: emptyCounts, ts: Date.now() });
  return emptyCounts;
}

export async function fetchAllConcurrently(codes: string[]): Promise<Record<string, Set<string>>> {
  const results: Record<string, Set<string>> = {};
  await mapConcurrent(codes, 6, async (code) => {
    results[code.toLowerCase()] = await getParticipants(code);
  });
  return results;
}

export async function getCampaignStructuralMetrics(code: string): Promise<{
  quality_image_share: number;
  top10_uploader_share: number;
  usage_share: number;
  total_uploads: number;
}> {
  const clean = code.replace(/\s+/g, '').toLowerCase();
  const cached = _metricsCache.get(clean);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.data;
  }

  const match = CODE_RE.exec(clean);
  const isAll = match && match[1] === 'all';

  const countsMap = await getParticipantsWithUploadCounts(clean);
  const uploadCounts = Array.from(countsMap.values());
  let totalUploads = uploadCounts.reduce((a, b) => a + b, 0);

  // If upload counts from user mapping are 0, check candidate categories on Commons directly
  if (!isAll && totalUploads === 0) {
    const categories = getCategoryCandidates(clean);
    for (const cat of categories) {
      const fileCount = await fetchCategoryFileCount(cat);
      if (fileCount > 0) {
        totalUploads = fileCount;
        break;
      }
    }
  }

  if (!isAll && countsMap.size === 0 && totalUploads === 0) {
    const emptyMetrics = {
      quality_image_share: 0.0,
      top10_uploader_share: 0.0,
      usage_share: 0.0,
      total_uploads: 0
    };
    _metricsCache.set(clean, { data: emptyMetrics, ts: Date.now() });
    return emptyMetrics;
  }

  uploadCounts.sort((a, b) => b - a);

  const top10Count = Math.max(1, Math.ceil(countsMap.size * 0.10));
  const top10Uploads = uploadCounts.slice(0, top10Count).reduce((a, b) => a + b, 0);
  const top10Share = totalUploads > 0 && top10Uploads > 0 ? parseFloat(((top10Uploads / totalUploads) * 100).toFixed(1)) : (countsMap.size > 0 ? 100.0 : 0.0);

  if (isAll) {
    const subCodes = getSubCampaignCodes(clean);
    let totalSubUploads = 0;
    let totalQualityCount = 0;
    let weightedUsageSum = 0;

    for (const sub of subCodes) {
      const subMetrics = await getCampaignStructuralMetrics(sub);
      if (subMetrics.total_uploads > 0) {
        totalSubUploads += subMetrics.total_uploads;
        const qCount = Math.round((subMetrics.total_uploads * subMetrics.quality_image_share) / 100);
        totalQualityCount += qCount;
        weightedUsageSum += subMetrics.total_uploads * subMetrics.usage_share;
      }
    }

    const effectiveTotalUploads = totalUploads > 0 ? totalUploads : totalSubUploads;
    const qualityShare = effectiveTotalUploads > 0 ? parseFloat(((totalQualityCount / effectiveTotalUploads) * 100).toFixed(1)) : 0.0;
    const usageShare = totalSubUploads > 0 ? parseFloat((weightedUsageSum / totalSubUploads).toFixed(1)) : 0.0;

    const metrics = {
      quality_image_share: qualityShare,
      top10_uploader_share: countsMap.size > 0 ? top10Share : 0.0,
      usage_share: usageShare,
      total_uploads: effectiveTotalUploads
    };
    _metricsCache.set(clean, { data: metrics, ts: Date.now() });
    return metrics;
  }

  // Real Quality Images category discovery
  let qualityCount = 0;
  const categories = getCategoryCandidates(clean);
  for (const cat of categories) {
    const catClean = cat.replace(/_/g, ' ');
    const qiCandidates = [
      catClean.replace('Images from ', 'Quality images from '),
      `Quality images from ${catClean.replace('Images from ', '')}`,
      `Quality images from ${catClean}`
    ];
    for (const qcat of qiCandidates) {
      if (qcat === catClean || qcat === cat) continue;
      const count = await fetchCategoryFileCount(qcat);
      if (count > 0) {
        qualityCount = count;
        break;
      }
    }
    if (qualityCount > 0) break;
  }

  const qualityShare = totalUploads > 0 ? parseFloat(((qualityCount / totalUploads) * 100).toFixed(1)) : 0.0;

  // Real Global Usage sampling (50 files from Commons category)
  let sampledFiles = 0;
  let usedFiles = 0;
  for (const cat of categories) {
    try {
      const uController = new AbortController();
      const uTimeout = setTimeout(() => uController.abort(), 4000);
      const uRes = await fetch(
        `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=categorymembers&gcmtitle=Category:${encodeURIComponent(cat)}&gcmtype=file&gcmlimit=50&prop=globalusage&gulimit=5`,
        {
          headers: { 'User-Agent': 'CampTools/1.0 (https://camptools.toolforge.org; tanvirsdq@toolforge.org)' },
          signal: uController.signal
        }
      );
      clearTimeout(uTimeout);
      if (uRes.ok) {
        const uData = await uRes.json();
        const pages = uData?.query?.pages || {};
        for (const pid of Object.keys(pages)) {
          sampledFiles++;
          const gu = pages[pid]?.globalusage || [];
          if (gu.length > 0) usedFiles++;
        }
      }
    } catch {
      // Fall through
    }
    if (sampledFiles > 0) break;
  }

  const usageShare = sampledFiles > 0 ? parseFloat(((usedFiles / sampledFiles) * 100).toFixed(1)) : 0.0;

  const metrics = {
    quality_image_share: qualityShare,
    top10_uploader_share: countsMap.size > 0 ? top10Share : 0.0,
    usage_share: usageShare,
    total_uploads: totalUploads
  };

  _metricsCache.set(clean, { data: metrics, ts: Date.now() });
  return metrics;
}

export async function fetchStructuralMetricsConcurrently(codes: string[]): Promise<Record<string, any>> {
  const results: Record<string, any> = {};
  await mapConcurrent(codes, 6, async (code) => {
    results[code.toLowerCase()] = await getCampaignStructuralMetrics(code);
  });
  return results;
}

// =========================================================================
// RETENTION CALCULATIONS & VISUALIZATIONS
// =========================================================================

function extractYear(code: string): number {
  const m = CODE_RE.exec(code);
  return m ? 2000 + parseInt(m[3], 10) : 0;
}

export function computeRetentionPercentages(
  events: Record<string, Set<string>>,
  forwardOnly = false,
  returnDict = false
): any {
  const codes = Object.keys(events);
  const sortedCodes = [...codes].sort((a, b) => extractYear(a) - extractYear(b) || a.localeCompare(b));
  const codeIndex = new Map(sortedCodes.map((c, i) => [c, i]));

  const forwardPercentages: number[] = [];
  const backwardPercentages: number[] = [];
  const allPercentages: number[] = [];

  for (const source of codes) {
    const sourceUsers = events[source];
    if (!sourceUsers || sourceUsers.size === 0) continue;

    for (const target of codes) {
      if (source === target) continue;
      const targetUsers = events[target];
      if (!targetUsers) continue;

      let overlap = 0;
      for (const u of sourceUsers) {
        if (targetUsers.has(u)) overlap++;
      }
      const pct = (overlap / sourceUsers.size) * 100.0;
      allPercentages.push(pct);

      const srcYr = extractYear(source);
      const tgtYr = extractYear(target);
      const srcIdx = codeIndex.get(source) || 0;
      const tgtIdx = codeIndex.get(target) || 0;

      if (srcYr < tgtYr || (srcYr === tgtYr && srcIdx < tgtIdx)) {
        forwardPercentages.push(pct);
      } else {
        backwardPercentages.push(pct);
      }
    }
  }

  if (returnDict) {
    return {
      forward: forwardPercentages,
      backward: backwardPercentages,
      all: allPercentages
    };
  }
  if (forwardOnly) return forwardPercentages;
  return allPercentages;
}

export function buildGlobalTable(validCountries: Record<string, Record<string, Set<string>>>): string {
  const rows: Array<{
    country: string;
    occurrences: number;
    forwardRetention: number;
    avgRetention: number;
    medianRetention: number;
    maxRetention: number;
  }> = [];

  for (const [countryCode, events] of Object.entries(validCountries)) {
    const retDict = computeRetentionPercentages(events, false, true);
    const { all, forward } = retDict;
    if (!all || all.length === 0) continue;

    const fwdVal = forward.length ? computeEmpiricalMean(forward) : computeEmpiricalMean(all);
    const maxVal = Math.max(...all);

    rows.push({
      country: countryDisplayName(countryCode),
      occurrences: Object.keys(events).length,
      forwardRetention: parseFloat(fwdVal.toFixed(1)),
      avgRetention: parseFloat(computeEmpiricalMean(all).toFixed(1)),
      medianRetention: computeEmpiricalMedian(all) ?? 0,
      maxRetention: parseFloat(maxVal.toFixed(1))
    });
  }

  rows.sort((a, b) => a.country.localeCompare(b.country));

  if (!rows.length) return '';

  let html = `<table class="data-table"><thead><tr>
    <th>#</th>
    <th>Country</th>
    <th>Occurrences</th>
    <th>Forward Retention (%)</th>
    <th>Avg Retention (%)</th>
    <th>Median Retention (%)</th>
    <th>Max Retention (%)</th>
  </tr></thead><tbody>`;

  rows.forEach((r, idx) => {
    html += `<tr>
      <td>${idx + 1}</td>
      <td><strong>${r.country}</strong></td>
      <td>${r.occurrences}</td>
      <td>${r.forwardRetention}%</td>
      <td>${r.avgRetention}%</td>
      <td>${r.medianRetention}%</td>
      <td>${r.maxRetention}%</td>
    </tr>`;
  });

  html += `</tbody></table>`;
  return html;
}

export function buildWorldData(
  validCountries: Record<string, Record<string, Set<string>>>,
  metric: string
): Array<{ country: string; retention: number; occurrences: number }> {
  const rows: Array<{ country: string; retention: number; occurrences: number }> = [];

  for (const [countryCode, events] of Object.entries(validCountries)) {
    const percentages = computeRetentionPercentages(events);
    if (!percentages.length) continue;

    const val = metric === 'Average' ? computeEmpiricalMean(percentages) : (computeEmpiricalMedian(percentages) ?? 0);
    rows.push({
      country: countryDisplayName(countryCode),
      retention: parseFloat(val.toFixed(1)),
      occurrences: Object.keys(events).length
    });
  }

  rows.sort((a, b) => a.country.localeCompare(b.country));
  return rows;
}

export function createWorldMapHtml(
  worldData: Array<{ country: string; retention: number; occurrences: number }>,
  metricChoice: string
): string {
  if (!worldData.length) return '';

  const jsonLocations = JSON.stringify(worldData.map((d) => d.country));
  const jsonZ = JSON.stringify(worldData.map((d) => d.retention));
  const jsonHover = JSON.stringify(
    worldData.map((d) => `<b>${d.country}</b><br>Editions: ${d.occurrences}<br>Retention: ${d.retention}%`)
  );

  return `
    <div id="retention-worldmap-wrapper" style="position: relative; width: 100%; min-height: 460px; background: #ffffff; border: 1px solid var(--border-color, #e0e0e0); border-radius: 0; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.04);">
      <div id="retention-worldmap" style="width: 100%; height: 460px;"></div>
      <div id="retention-worldmap-loading" style="position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; background: rgba(255,255,255,0.92); z-index: 10; gap: 10px; font-family: 'Inter', sans-serif;">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#256d85" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="animation: spin 1s linear infinite;"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
        <span style="font-size: 0.88rem; color: #54595d; font-weight: 500;">Rendering geographic choropleth projection...</span>
      </div>
    </div>
    <style>@keyframes spin { 100% { transform: rotate(360deg); } }</style>
    <script>
      (function() {
        var attempts = 0;
        function renderMap() {
          if (typeof Plotly === 'undefined') {
            attempts++;
            if (attempts > 12 && !document.getElementById('plotly-fallback-cdn')) {
              var script = document.createElement('script');
              script.id = 'plotly-fallback-cdn';
              script.src = '/plotly.min.js';
              script.onload = renderMap;
              document.head.appendChild(script);
              return;
            }
            setTimeout(renderMap, 100);
            return;
          }

          var loader = document.getElementById('retention-worldmap-loading');

          var data = [{
            type: 'choropleth',
            locationmode: 'country names',
            locations: ${jsonLocations},
            z: ${jsonZ},
            text: ${jsonHover},
            hoverinfo: 'text',
            colorscale: [
              [0.0, '#eef7fa'],
              [0.2, '#a8dfed'],
              [0.4, '#72ded6'],
              [0.7, '#256d85'],
              [1.0, '#183f54']
            ],
            autocolorscale: false,
            marker: { line: { color: '#ffffff', width: 1.2 } },
            colorbar: {
              title: { text: '${metricChoice} (%)', font: { color: '#202122', size: 12, family: 'Inter, sans-serif' } },
              tickfont: { color: '#54595d', size: 11 },
              ticksuffix: '%',
              len: 0.75,
              outlinewidth: 0,
              thickness: 16
            }
          }];

          var layout = {
            title: {
              text: '<b>${metricChoice} Longitudinal Participant Retention by Nation</b>',
              x: 0.03,
              y: 0.95,
              font: { color: '#202122', size: 14, family: 'Inter, sans-serif' }
            },
            geo: {
              showframe: false,
              showcoastlines: true,
              coastlinecolor: '#c8ccd1',
              coastlinewidth: 0.8,
              showcountries: true,
              countrycolor: '#c8ccd1',
              countrywidth: 0.8,
              showland: true,
              landcolor: '#f8f9fa',
              showocean: true,
              oceancolor: '#edf2f7',
              showlakes: true,
              lakecolor: '#edf2f7',
              bgcolor: 'transparent',
              projection: { type: 'natural earth' }
            },
            margin: { r: 10, t: 45, l: 10, b: 10 },
            paper_bgcolor: '#ffffff',
            plot_bgcolor: '#ffffff'
          };

          var config = {
            responsive: true,
            displayModeBar: true,
            displaylogo: false,
            modeBarButtonsToRemove: ['lasso2d', 'select2d']
          };

          try {
            Plotly.newPlot('retention-worldmap', data, layout, config).then(function() {
              if (loader) loader.style.display = 'none';
            }).catch(function() {
              if (loader) loader.style.display = 'none';
            });
          } catch (e) {
            console.error('Plotly render error:', e);
            if (loader) loader.style.display = 'none';
          }
        }

        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', renderMap);
        } else {
          renderMap();
        }
      })();
    </script>
  `;
}

// Generate an SVG retention heatmap
export function createHeatmapSvg(events: Record<string, Set<string>>, countryName: string): string {
  const codes = Object.keys(events);
  const n = codes.length;
  if (n === 0) return '';

  const labels = codes.map((c) => {
    const m = CODE_RE.exec(c);
    if (m) {
      const [, evt, , yr] = m;
      return `${EVENT_MAP[evt] || evt.toUpperCase()} 20${yr}`;
    }
    return c;
  });

  // Calculate pairwise matrix
  const matrix: number[][] = [];
  for (let i = 0; i < n; i++) {
    matrix[i] = [];
    const srcUsers = events[codes[i]];
    for (let j = 0; j < n; j++) {
      if (i === j) {
        matrix[i][j] = srcUsers && srcUsers.size > 0 ? 100.0 : 0.0;
      } else {
        const tgtUsers = events[codes[j]];
        if (!srcUsers || srcUsers.size === 0 || !tgtUsers) {
          matrix[i][j] = 0.0;
        } else {
          let overlap = 0;
          for (const u of srcUsers) {
            if (tgtUsers.has(u)) overlap++;
          }
          matrix[i][j] = (overlap / srcUsers.size) * 100.0;
        }
      }
    }
  }

  const cellSize = Math.max(54, Math.min(84, Math.floor(400 / n)));
  const margin = { top: 60, right: 30, bottom: 135, left: 140 };
  const width = margin.left + n * cellSize + margin.right;
  const height = margin.top + n * cellSize + margin.bottom;

  function getColor(pct: number): string {
    const clamped = Math.max(0, Math.min(100, pct));
    if (clamped === 100) return '#0f172a'; // Full retention / self-cohort (Solid Dark Slate)
    if (clamped >= 50) return '#1e40af';   // Solid Deep Blue
    if (clamped >= 30) return '#2563eb';   // Solid Royal Blue
    if (clamped >= 20) return '#38bdf8';   // Solid Vibrant Sky Blue
    if (clamped >= 10) return '#bae6fd';   // Solid Soft Sky Blue
    if (clamped > 0) return '#f0f9ff';     // Solid Pale Ice Blue
    return '#f8fafc';                      // Solid Neutral Off-White (0% overlap)
  }

  function getTextColor(pct: number): string {
    if (pct >= 30) return '#ffffff';
    if (pct >= 20) return '#0f172a';
    return '#475569';
  }

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="background:#ffffff; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Inter', sans-serif;">`;
  
  // Title
  svg += `<text x="${width / 2}" y="30" text-anchor="middle" font-size="14" font-weight="700" fill="#202122">${countryName.replace(/_/g, ' ')} Retention Matrix</text>`;

  // Y axis label
  svg += `<text x="20" y="${margin.top + (n * cellSize) / 2}" text-anchor="middle" transform="rotate(-90, 20, ${margin.top + (n * cellSize) / 2})" font-size="11" font-weight="600" fill="#54595d">Source Cohort</text>`;

  // X axis label
  svg += `<text x="${margin.left + (n * cellSize) / 2}" y="${height - 26}" text-anchor="middle" font-size="11" font-weight="600" fill="#54595d">Target Cohort</text>`;

  // Row labels
  for (let i = 0; i < n; i++) {
    const y = margin.top + i * cellSize + cellSize / 2 + 4;
    svg += `<text x="${margin.left - 12}" y="${y}" text-anchor="end" font-size="11" font-weight="500" fill="#202122">${labels[i]}</text>`;
  }

  // Column labels
  for (let j = 0; j < n; j++) {
    const x = margin.left + j * cellSize + cellSize / 2;
    const y = margin.top + n * cellSize + 16;
    svg += `<text x="${x}" y="${y}" text-anchor="end" transform="rotate(-35, ${x}, ${y})" font-size="11" font-weight="500" fill="#202122">${labels[j]}</text>`;
  }

  // Heatmap cells
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const val = matrix[i][j];
      const x = margin.left + j * cellSize;
      const y = margin.top + i * cellSize;
      const fill = getColor(val);
      const textFill = getTextColor(val);

      svg += `<rect x="${x + 1}" y="${y + 1}" width="${cellSize - 2}" height="${cellSize - 2}" rx="0" ry="0" fill="${fill}" stroke="#ffffff" stroke-width="1.5" />`;
      svg += `<text x="${x + cellSize / 2}" y="${y + cellSize / 2 + 4}" text-anchor="middle" font-size="11" font-weight="700" fill="${textFill}">${val.toFixed(1)}%</text>`;
    }
  }

  // Subtle watermark at bottom right
  svg += `<text x="${width - 16}" y="${height - 8}" text-anchor="end" font-size="8.5" font-weight="500" fill="#94a3b8">camptools.toolforge.org · CampTools</text>`;

  svg += `</svg>`;
  return Buffer.from(svg).toString('base64');
}

// =========================================================================
// INFLUX CALCULATIONS & BAR CHART
// =========================================================================

export async function computeYoYInflux(campaignCodes: string[]): Promise<{
  records: Array<{
    code: string;
    year: number;
    total_active: number;
    new_contributors: number;
    returning_contributors: number;
    newcomer_share_pct: number;
    veteran_share_pct: number;
    retention_from_prev_pct: number;
    cumulative_pool: number;
    yoy_growth_pct: number;
    new_to_veteran_ratio: number | null;
    ratio_status: string;
    is_baseline: boolean;
    breakdown_str: string;
  }>;
  summary: {
    total_unique_community: number;
    avg_newcomer_share_pct: number;
    peak_influx_year: number | string;
    peak_influx_count: number;
    peak_edition_year: number | string;
    peak_edition_count: number;
    latest_year: number | string;
    latest_total: number;
    latest_new: number;
    latest_returning: number;
  };
  lifecycle: {
    one_time: number;
    repeat_2_3: number;
    core_4_plus: number;
  };
}> {
  const cleanedCodes = campaignCodes.map((c) => c.replace(/\s+/g, '').toLowerCase()).filter((c) => CODE_RE.test(c));
  const codeToUsers = await fetchAllConcurrently(cleanedCodes);

  const yearToCodes: Record<number, string[]> = {};
  for (const c of cleanedCodes) {
    const m = CODE_RE.exec(c);
    if (m) {
      const yr = 2000 + parseInt(m[3], 10);
      if (!yearToCodes[yr]) yearToCodes[yr] = [];
      yearToCodes[yr].push(c);
    }
  }

  const sortedYears = Object.keys(yearToCodes).map(Number).sort((a, b) => a - b);
  const records: any[] = [];
  const seenAllPrior = new Set<string>();
  const userEditionCounts: Record<string, number> = {};
  let prevUsers = new Set<string>();

  for (let idx = 0; idx < sortedYears.length; idx++) {
    const yr = sortedYears[idx];
    const codesForYr = yearToCodes[yr];
    const currentUsers = new Set<string>();
    for (const c of codesForYr) {
      const users = codeToUsers[c] || new Set<string>();
      for (const u of users) currentUsers.add(u);
    }

    const totalActive = currentUsers.size;
    let newUsers = 0;
    let returningUsers = 0;

    for (const u of currentUsers) {
      userEditionCounts[u] = (userEditionCounts[u] || 0) + 1;
      if (seenAllPrior.has(u)) {
        returningUsers++;
      } else {
        newUsers++;
      }
    }

    const isBaseline = idx === 0;
    let yoyGrowth = 0;
    let retentionFromPrev = 0;
    let ratio: number | null = null;
    let ratioStatus = 'Baseline Edition';

    if (!isBaseline && prevUsers.size > 0) {
      let overlapWithPrev = 0;
      for (const u of currentUsers) {
        if (prevUsers.has(u)) overlapWithPrev++;
      }
      retentionFromPrev = (overlapWithPrev / prevUsers.size) * 100;
      yoyGrowth = ((totalActive - prevUsers.size) / prevUsers.size) * 100;

      if (returningUsers > 0) {
        ratio = parseFloat((newUsers / returningUsers).toFixed(2));
        ratioStatus = 'Active';
      } else {
        ratioStatus = 'Zero Returning';
      }
    }

    const newcomerShare = totalActive > 0 ? (newUsers / totalActive) * 100 : 0;
    const veteranShare = totalActive > 0 ? (returningUsers / totalActive) * 100 : 0;

    for (const u of currentUsers) seenAllPrior.add(u);

    const breakdownItems = codesForYr.map((c) => {
      const m = CODE_RE.exec(c);
      const evt = m ? (EVENT_MAP[m[1]] || m[1].toUpperCase()) : c;
      return `${evt}: ${(codeToUsers[c] || new Set()).size.toLocaleString()}`;
    });

    records.push({
      code: codesForYr.length === 1 ? codesForYr[0] : `Combined (${codesForYr.length} events)`,
      year: yr,
      total_active: totalActive,
      new_contributors: newUsers,
      returning_contributors: returningUsers,
      newcomer_share_pct: parseFloat(newcomerShare.toFixed(1)),
      veteran_share_pct: parseFloat(veteranShare.toFixed(1)),
      retention_from_prev_pct: parseFloat(retentionFromPrev.toFixed(1)),
      cumulative_pool: seenAllPrior.size,
      yoy_growth_pct: parseFloat(yoyGrowth.toFixed(1)),
      new_to_veteran_ratio: ratio,
      ratio_status: ratioStatus,
      is_baseline: isBaseline,
      breakdown_str: breakdownItems.join(', ') || 'Single stream'
    });

    prevUsers = currentUsers;
  }

  const lifecycle = {
    one_time: 0,
    repeat_2_3: 0,
    core_4_plus: 0
  };

  for (const count of Object.values(userEditionCounts)) {
    if (count === 1) lifecycle.one_time++;
    else if (count <= 3) lifecycle.repeat_2_3++;
    else lifecycle.core_4_plus++;
  }

  let summary: any;
  if (records.length > 0) {
    const avgNewcomer = records.reduce((s, r) => s + r.newcomer_share_pct, 0) / records.length;
    const peakInflux = [...records].sort((a, b) => b.new_contributors - a.new_contributors)[0];
    const peakTotal = [...records].sort((a, b) => b.total_active - a.total_active)[0];
    const latest = records[records.length - 1];

    summary = {
      total_unique_community: Object.keys(userEditionCounts).length,
      avg_newcomer_share_pct: parseFloat(avgNewcomer.toFixed(1)),
      peak_influx_year: peakInflux.year,
      peak_influx_count: peakInflux.new_contributors,
      peak_edition_year: peakTotal.year,
      peak_edition_count: peakTotal.total_active,
      latest_year: latest.year,
      latest_total: latest.total_active,
      latest_new: latest.new_contributors,
      latest_returning: latest.returning_contributors
    };
  } else {
    summary = {
      total_unique_community: 0,
      avg_newcomer_share_pct: 0.0,
      peak_influx_year: '-',
      peak_influx_count: 0,
      peak_edition_year: '-',
      peak_edition_count: 0,
      latest_year: '-',
      latest_total: 0,
      latest_new: 0,
      latest_returning: 0
    };
  }

  return { records, summary, lifecycle };
}

// Generate an SVG stacked bar chart with secondary cumulative pool line for YoY influx
export function createInfluxBarchartSvg(records: any[], title: string): string {
  if (!records.length) return '';

  const width = 780;
  const height = 445;
  const margin = { top: 76, right: 65, bottom: 58, left: 65 };

  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;

  const maxTotal = Math.max(...records.map((r) => r.total_active), 10);
  const yMax = Math.ceil(maxTotal * 1.38);

  const maxCumulative = Math.max(...records.map((r) => r.cumulative_pool || r.total_active), 10);
  const yMaxCum = Math.ceil(maxCumulative * 1.15);

  const numBars = records.length;
  const barBand = plotW / numBars;
  const barWidth = Math.min(64, barBand * 0.52);

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="background:#ffffff; font-family:'Inter', sans-serif;">`;

  // Chart Title
  svg += `<text x="${width / 2}" y="26" text-anchor="middle" font-size="15" font-weight="700" fill="#202122">${title}</text>`;

  // Clean Top Legend (Placed right beneath title for instant context)
  svg += `
    <g transform="translate(${width / 2 - 165}, 46)">
      <!-- Returning -->
      <rect x="0" y="-8" width="11" height="11" rx="0" ry="0" fill="#1e3a8a" />
      <text x="17" y="1" font-size="11" font-weight="500" fill="#334155">Returning</text>
      <!-- Newcomers -->
      <rect x="95" y="-8" width="11" height="11" rx="0" ry="0" fill="#0284c7" />
      <text x="112" y="1" font-size="11" font-weight="500" fill="#334155">Newcomers</text>
      <!-- Cumulative Line -->
      <line x1="205" y1="-3" x2="228" y2="-3" stroke="#d97706" stroke-width="2.5" />
      <circle cx="216.5" cy="-3" r="3.5" fill="#ffffff" stroke="#d97706" stroke-width="2" />
      <text x="236" y="1" font-size="11" font-weight="500" fill="#334155">Cumulative Pool</text>
    </g>
  `;

  // Y-axis gridlines & left ticks (Active Volume)
  const ticks = 5;
  for (let i = 0; i <= ticks; i++) {
    const val = Math.round((yMax / ticks) * i);
    const y = margin.top + plotH - (val / yMax) * plotH;
    svg += `<line x1="${margin.left}" y1="${y}" x2="${width - margin.right}" y2="${y}" stroke="#f1f3f5" stroke-dasharray="3,3" stroke-width="1" />`;
    svg += `<text x="${margin.left - 10}" y="${y + 4}" text-anchor="end" font-size="10" fill="#54595d">${val.toLocaleString()}</text>`;

    // Right Y-axis ticks (Cumulative Pool)
    const valCum = Math.round((yMaxCum / ticks) * i);
    svg += `<text x="${width - margin.right + 10}" y="${y + 4}" text-anchor="start" font-size="10" font-weight="600" fill="#d97706">${valCum.toLocaleString()}</text>`;
  }

  // Base baseline
  svg += `<line x1="${margin.left}" y1="${margin.top + plotH}" x2="${width - margin.right}" y2="${margin.top + plotH}" stroke="#cbd5e1" stroke-width="1.5" />`;

  // Coordinates for cumulative line
  const linePoints: { x: number; y: number; pool: number; barTopY: number }[] = [];

  // Draw Stacked Bars (Sharp cornered, zero rounding)
  records.forEach((rec, idx) => {
    const cx = margin.left + idx * barBand + barBand / 2;
    const x = cx - barWidth / 2;

    const retH = (rec.returning_contributors / yMax) * plotH;
    const newH = (rec.new_contributors / yMax) * plotH;

    const retY = margin.top + plotH - retH;
    const newY = retY - newH;

    // Pre-calculate cumulative line point for this column to test visual clearance
    const cumY = margin.top + plotH - ((rec.cumulative_pool || rec.total_active) / yMaxCum) * plotH;
    linePoints.push({ x: cx, y: cumY, pool: rec.cumulative_pool || rec.total_active, barTopY: newY });

    // Returning Users (Solid Deep Navy - sharp rectangle)
    if (retH > 0) {
      svg += `<rect x="${x}" y="${retY}" width="${barWidth}" height="${retH}" rx="0" ry="0" fill="#1e3a8a" />`;
      if (retH >= 20) {
        svg += `<text x="${cx}" y="${retY + retH / 2 + 4}" text-anchor="middle" font-size="10" font-weight="600" fill="#ffffff">${rec.returning_contributors.toLocaleString()}</text>`;
      }
    }

    // New Users (Solid Sky Blue - sharp rectangle)
    if (newH > 0) {
      svg += `<rect x="${x}" y="${newY}" width="${barWidth}" height="${newH}" rx="0" ry="0" fill="#0284c7" />`;
      // Display segment text if tall enough AND clear of the crossing cumulative trendline
      const newMidY = newY + newH / 2 + 4;
      if (newH >= 24 && rec.returning_contributors > 0 && Math.abs(cumY - newMidY) > 28) {
        svg += `<text x="${cx}" y="${newMidY}" text-anchor="middle" font-size="10" font-weight="600" fill="#ffffff">${rec.new_contributors.toLocaleString()}</text>`;
      }
    }

    // Total on top of bar with crisp white halo to protect against any intersecting elements
    const totalY = newY - 6;
    svg += `<text x="${cx}" y="${totalY}" text-anchor="middle" font-size="11" font-weight="700" fill="#202122" stroke="#ffffff" stroke-width="3" paint-order="stroke fill">${rec.total_active.toLocaleString()}</text>`;

    // X-axis label (Year)
    svg += `<text x="${cx}" y="${margin.top + plotH + 18}" text-anchor="middle" font-size="12" font-weight="600" fill="#202122">${rec.year}</text>`;

    // YoY Badge under year
    if (!rec.is_baseline) {
      const sign = rec.yoy_growth_pct >= 0 ? '+' : '';
      const color = rec.yoy_growth_pct >= 0 ? '#15803d' : '#b91c1c';
      svg += `<text x="${cx}" y="${margin.top + plotH + 34}" text-anchor="middle" font-size="10" font-weight="600" fill="${color}">${sign}${rec.yoy_growth_pct}%</text>`;
    } else {
      svg += `<text x="${cx}" y="${margin.top + plotH + 34}" text-anchor="middle" font-size="10" fill="#54595d">Baseline</text>`;
    }
  });

  // Draw Cumulative Pool Line (Secondary Axis)
  if (linePoints.length > 0) {
    const pathD = linePoints.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x} ${pt.y}`).join(' ');

    // Connective cumulative trendline
    svg += `<path d="${pathD}" fill="none" stroke="#d97706" stroke-width="2.6" stroke-linecap="square" stroke-linejoin="miter" />`;

    // Data points and point pill labels (sharp corners)
    linePoints.forEach((pt) => {
      // White halo circle + Amber dot
      svg += `<circle cx="${pt.x}" cy="${pt.y}" r="4.5" fill="#ffffff" stroke="#d97706" stroke-width="2.5" />`;
      // Pool value label with crisp pill background to eliminate collisions
      const strVal = pt.pool.toLocaleString();
      const pillW = Math.max(34, strVal.length * 6.5 + 10);
      const pillH = 16;
      const pillX = pt.x - pillW / 2;

      // Dynamic vertical offset: If cumulative point is near bar top (within 35px), elevate pill to guarantee at least 14px clearance
      let pillY = pt.y - 20;
      if (Math.abs(pt.y - pt.barTopY) < 36) {
        pillY = Math.min(pt.y - 28, pt.barTopY - 36);
      }
      // Ensure pill never overflows the top chart margin
      pillY = Math.max(margin.top - 12, pillY);

      svg += `<rect x="${pillX}" y="${pillY}" width="${pillW}" height="${pillH}" rx="0" ry="0" fill="#fffbeb" stroke="#f59e0b" stroke-width="1" />`;
      svg += `<text x="${pt.x}" y="${pillY + 11.5}" text-anchor="middle" font-size="9" font-weight="700" fill="#b45309">${strVal}</text>`;
    });
  }

  // Subtle attribution and tool URL watermark at bottom corners
  svg += `<text x="${margin.left}" y="${height - 10}" text-anchor="start" font-size="9" fill="#94a3b8">Wikimedia Contributor Volume</text>`;
  svg += `<text x="${width - margin.right}" y="${height - 10}" text-anchor="end" font-size="9" font-weight="500" fill="#94a3b8">camptools.toolforge.org · CampTools</text>`;

  svg += `</svg>`;
  return Buffer.from(svg).toString('base64');
}

// =========================================================================
// HEALTH EVALUATION ENGINE
// =========================================================================

export function computeEmpiricalMedian(arr: number[]): number | null {
  if (!arr || arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const med = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  return parseFloat(med.toFixed(1));
}

export function calculateStars(score: number): [string, number] {
  const norm = Math.min(Math.max(score / 100, 0), 1);
  const stars = Math.min(5, Math.max(1, Math.round(norm * 5)));
  return ['★'.repeat(stars) + '☆'.repeat(5 - stars), stars];
}

export function calculateRelativeScore(
  metricValue: number,
  benchmarkValue: number,
  positiveIsHigher = true,
  isScale = false
): number {
  if (positiveIsHigher) {
    if (metricValue <= 0) return 0.0;
    const bm = Math.max(benchmarkValue, 0.5);
    if (metricValue <= bm) {
      const exp = isScale ? 1.15 : 0.75;
      return parseFloat((70.0 * Math.pow(metricValue / bm, exp)).toFixed(1));
    }
    const excess = (metricValue - bm) / bm;
    const score = 70.0 + 30.0 * (1.0 - Math.exp(-1.5 * excess));
    return parseFloat(Math.min(100.0, score).toFixed(1));
  } else {
    if (metricValue >= 100.0) return 15.0;
    if (metricValue <= 10.0) return 100.0;
    const bm = Math.min(Math.max(benchmarkValue, 20.0), 90.0);
    if (metricValue > bm) {
      const ratio = (metricValue - bm) / (100.0 - bm);
      return parseFloat(Math.max(15.0, 70.0 - 55.0 * Math.pow(ratio, 0.85)).toFixed(1));
    }
    const ratio = (bm - metricValue) / (bm - 10.0);
    return parseFloat(Math.min(100.0, 70.0 + 30.0 * Math.pow(ratio, 0.85)).toFixed(1));
  }
}

export function generateHealthMetrics(
  targetUsers: Set<string>,
  baselineUsers: Set<string>,
  structuralMetrics: any,
  benchmarks: any,
  baselineStructural?: any
): Record<string, any> {
  const metrics: Record<string, any> = {};
  const isInaugural = !baselineUsers || baselineUsers.size === 0;
  const targetCount = targetUsers.size;
  const baseCount = baselineUsers ? baselineUsers.size : 0;
  const totalUploads = structuralMetrics.total_uploads || 0;
  const baseUploads = baselineStructural?.total_uploads || 0;

  // 1. Community Scale (Active Uploaders Volume)
  const scaleBm = typeof benchmarks.scale === 'number' ? benchmarks.scale : null;
  const scaleDelta = !isInaugural ? targetCount - baseCount : null;
  const scaleDeltaPct = !isInaugural && baseCount > 0 ? parseFloat((((targetCount - baseCount) / baseCount) * 100).toFixed(1)) : null;
  let scaleDeltaFormatted = 'Inaugural';
  if (!isInaugural && scaleDelta !== null && scaleDeltaPct !== null) {
    scaleDeltaFormatted = scaleDelta >= 0 ? `▲ +${scaleDelta.toLocaleString()} (+${scaleDeltaPct}%)` : `▼ -${Math.abs(scaleDelta).toLocaleString()} (${scaleDeltaPct}%)`;
  }
  const scaleRegDelta = scaleBm !== null ? Math.round(targetCount - scaleBm) : null;

  metrics.Scale = {
    raw: `${targetCount.toLocaleString()} uploaders`,
    count: targetCount,
    baseline_val: baseCount,
    yoy_delta: scaleDelta,
    yoy_delta_pct: scaleDeltaPct,
    yoy_delta_formatted: scaleDeltaFormatted,
    regional_median: scaleBm !== null ? Math.round(scaleBm) : null,
    regional_delta: scaleRegDelta,
    is_positive: scaleDelta !== null ? scaleDelta >= 0 : true,
    benchmark: scaleBm !== null ? Math.round(scaleBm) : null,
    is_inaugural: isInaugural
  };

  // 2. Contributor Retention
  const retBm = typeof benchmarks.retention === 'number' ? benchmarks.retention : null;
  if (isInaugural) {
    metrics.Retention = {
      raw: 'Inaugural Baseline',
      count: 0,
      baseline_val: 0,
      yoy_delta: null,
      yoy_delta_pct: null,
      yoy_delta_formatted: 'Inaugural',
      regional_median: retBm,
      regional_delta: null,
      benchmark: retBm,
      is_inaugural: true,
      is_positive: true
    };
  } else {
    let overlap = 0;
    for (const u of targetUsers) {
      if (baselineUsers.has(u)) overlap++;
    }
    const rawRate = parseFloat(((overlap / baseCount) * 100.0).toFixed(1));
    const regDelta = retBm !== null ? parseFloat((rawRate - retBm).toFixed(1)) : null;
    const retFormatted = `${overlap.toLocaleString()} / ${baseCount.toLocaleString()} (${rawRate.toFixed(1)}%)`;
    const retDeltaFormatted = regDelta !== null ? (regDelta >= 0 ? `▲ +${regDelta.toFixed(1)}% vs peer norm` : `▼ ${regDelta.toFixed(1)}% vs peer norm`) : `${rawRate.toFixed(1)}% retained`;

    metrics.Retention = {
      raw: `${rawRate.toFixed(1)}%`,
      raw_formatted: retFormatted,
      count: overlap,
      baseline_val: baseCount,
      yoy_delta: regDelta,
      yoy_delta_pct: rawRate,
      yoy_delta_formatted: retDeltaFormatted,
      regional_median: retBm,
      regional_delta: regDelta,
      benchmark: retBm,
      is_inaugural: false,
      is_positive: regDelta !== null ? regDelta >= 0 : true
    };
  }

  // 3. Contributor Expansion (First-Time Newcomers)
  let newUsersCount = 0;
  for (const u of targetUsers) {
    if (!baselineUsers || !baselineUsers.has(u)) newUsersCount++;
  }
  const expBm = typeof benchmarks.expansion === 'number' ? benchmarks.expansion : (typeof benchmarks.growth === 'number' ? benchmarks.growth : null);
  const newcomerShare = targetCount > 0 ? parseFloat(((newUsersCount / targetCount) * 100).toFixed(1)) : 0.0;
  const expRegDelta = expBm !== null ? Math.round(newUsersCount - expBm) : null;
  const expFormatted = `${newUsersCount.toLocaleString()} newcomers (${newcomerShare.toFixed(1)}%)`;
  const expDeltaFormatted = expRegDelta !== null ? (expRegDelta >= 0 ? `▲ +${expRegDelta.toLocaleString()} vs peer norm` : `▼ ${expRegDelta.toLocaleString()} vs peer norm`) : `${newUsersCount.toLocaleString()} newcomers`;

  metrics.Growth = {
    raw: `${newUsersCount.toLocaleString()} newcomers`,
    raw_formatted: expFormatted,
    count: newUsersCount,
    baseline_val: expBm !== null ? Math.round(expBm) : null,
    yoy_delta: expRegDelta,
    yoy_delta_pct: newcomerShare,
    yoy_delta_formatted: expDeltaFormatted,
    regional_median: expBm !== null ? Math.round(expBm) : null,
    regional_delta: expRegDelta,
    benchmark: expBm !== null ? Math.round(expBm) : null,
    newcomers_count: newUsersCount,
    is_positive: expRegDelta !== null ? expRegDelta >= 0 : true,
    is_inaugural: isInaugural
  };
  metrics.Expansion = metrics.Growth;

  // 4. Content Utility (Wikipedia Article Transclusions)
  const rawUsage = parseFloat(structuralMetrics.usage_share || 0.0);
  const rawUsageCount = Math.round((totalUploads * rawUsage) / 100);
  const useRateBm = typeof benchmarks.usage === 'number' ? benchmarks.usage : null;
  const useCountBm = typeof benchmarks.usage_count === 'number' ? benchmarks.usage_count : null;
  const useRegDelta = useRateBm !== null ? parseFloat((rawUsage - useRateBm).toFixed(1)) : null;
  const useDeltaFormatted = useRegDelta !== null ? (useRegDelta >= 0 ? `▲ +${useRegDelta.toFixed(1)}% vs peer norm` : `▼ ${useRegDelta.toFixed(1)}% vs peer norm`) : `${rawUsage.toFixed(1)}% usage`;

  metrics.Usage = {
    raw: rawUsage,
    count: rawUsageCount,
    raw_formatted: `${rawUsageCount.toLocaleString()} usages (${rawUsage.toFixed(1)}%)`,
    baseline_val: useRateBm,
    yoy_delta: useRegDelta,
    yoy_delta_pct: rawUsage,
    yoy_delta_formatted: useDeltaFormatted,
    regional_median: useRateBm,
    regional_delta: useRegDelta,
    benchmark: useRateBm,
    benchmark_count: useCountBm !== null ? Math.round(useCountBm) : null,
    is_positive: useRegDelta !== null ? useRegDelta >= 0 : true,
    is_inaugural: false
  };

  // 5. Quality Recognition (Quality / Featured Images)
  const rawQuality = parseFloat(structuralMetrics.quality_image_share || 0.0);
  const rawQualityCount = Math.round((totalUploads * rawQuality) / 100);
  const qualRateBm = typeof benchmarks.quality === 'number' ? benchmarks.quality : null;
  const qualCountBm = typeof benchmarks.quality_count === 'number' ? benchmarks.quality_count : null;
  const qualRegDelta = qualRateBm !== null ? parseFloat((rawQuality - qualRateBm).toFixed(1)) : null;
  const qualDeltaFormatted = qualRegDelta !== null ? (qualRegDelta >= 0 ? `▲ +${qualRegDelta.toFixed(1)}% vs peer norm` : `▼ ${qualRegDelta.toFixed(1)}% vs peer norm`) : `${rawQuality.toFixed(1)}% QI`;

  metrics.Quality = {
    raw: rawQuality,
    count: rawQualityCount,
    raw_formatted: `${rawQualityCount.toLocaleString()} works (${rawQuality.toFixed(1)}%)`,
    baseline_val: qualRateBm,
    yoy_delta: qualRegDelta,
    yoy_delta_pct: rawQuality,
    yoy_delta_formatted: qualDeltaFormatted,
    regional_median: qualRateBm,
    regional_delta: qualRegDelta,
    benchmark: qualRateBm,
    benchmark_count: qualCountBm !== null ? Math.round(qualCountBm) : null,
    is_positive: qualRegDelta !== null ? qualRegDelta >= 0 : true,
    is_inaugural: false
  };

  // 6. Contributor Diversity (Top 10% Upload Share)
  const rawDiversity = targetCount > 0 ? parseFloat(structuralMetrics.top10_uploader_share ?? 0.0) : 0.0;
  const divBm = typeof benchmarks.diversity === 'number' ? benchmarks.diversity : null;
  const divRegDelta = divBm !== null ? parseFloat((rawDiversity - divBm).toFixed(1)) : null;
  const divDeltaFormatted = divRegDelta !== null ? (divRegDelta <= 0 ? `▲ ${Math.abs(divRegDelta).toFixed(1)}% broader` : `▼ +${divRegDelta.toFixed(1)}% concentrated`) : `${rawDiversity.toFixed(1)}% by top 10%`;

  metrics.Diversity = {
    raw: rawDiversity,
    raw_formatted: `${rawDiversity.toFixed(1)}% by top 10%`,
    count: Math.max(1, Math.ceil(targetCount * 0.10)),
    baseline_val: divBm,
    yoy_delta: divRegDelta,
    yoy_delta_pct: rawDiversity,
    yoy_delta_formatted: divDeltaFormatted,
    regional_median: divBm,
    regional_delta: divRegDelta,
    benchmark: divBm,
    is_positive: divRegDelta !== null ? divRegDelta <= 0 : true,
    is_inaugural: false
  };

  // 7. Total Submissions Volume
  const uploadsDelta = !isInaugural && baseUploads > 0 ? totalUploads - baseUploads : null;
  const uploadsDeltaPct = !isInaugural && baseUploads > 0 ? parseFloat((((totalUploads - baseUploads) / baseUploads) * 100).toFixed(1)) : null;
  let uploadsDeltaFormatted = 'Inaugural';
  if (!isInaugural && uploadsDelta !== null && uploadsDeltaPct !== null) {
    uploadsDeltaFormatted = uploadsDelta >= 0 ? `▲ +${uploadsDelta.toLocaleString()} (+${uploadsDeltaPct}%)` : `▼ -${Math.abs(uploadsDelta).toLocaleString()} (${uploadsDeltaPct}%)`;
  }

  metrics.Uploads = {
    raw: `${totalUploads.toLocaleString()} files`,
    count: totalUploads,
    baseline_val: baseUploads,
    yoy_delta: uploadsDelta,
    yoy_delta_pct: uploadsDeltaPct,
    yoy_delta_formatted: uploadsDeltaFormatted,
    is_positive: uploadsDelta !== null ? uploadsDelta >= 0 : true,
    is_inaugural: isInaugural
  };

  return metrics;
}

export function generateInsights(
  metrics: Record<string, any>,
  regionName: string,
  benchmarks: any,
  counts?: { target: number; base: number; overlap: number }
): string[] {
  const insights: string[] = [];
  const regionLabel = regionName ? `${regionName} regional norm` : 'regional benchmark';
  const targetCount = counts?.target || 0;
  const baseCount = counts?.base || 0;
  const overlapCount = counts?.overlap || 0;
  const newcomerCount = Math.max(0, targetCount - overlapCount);

  // 1. Retention Insight
  if (metrics.Retention?.is_inaugural) {
    insights.push(
      'Inaugural campaign edition: Volunteer retention cannot be evaluated without a prior baseline cycle. Evaluation index dynamically calibrated across newcomer recruitment, content utility, quality recognition, and participation equity.'
    );
  } else {
    const rawRet = parseFloat(String(metrics.Retention?.raw || '0').replace('%', ''));
    const retBm = typeof benchmarks.retention === 'number' ? benchmarks.retention : null;
    if (retBm === null) {
      insights.push(
        `Retention is ${rawRet.toFixed(1)}%: retained ${overlapCount.toLocaleString()} out of ${baseCount.toLocaleString()} prior-edition contributors. Regional peer baseline unavailable (no concurrent regional peers).`
      );
    } else if (rawRet >= retBm) {
      insights.push(
        `Retention is strong (${rawRet.toFixed(1)}%): retained ${overlapCount.toLocaleString()} out of ${baseCount.toLocaleString()} prior-edition contributors (+${(rawRet - retBm).toFixed(1)}% above ${regionLabel} of ${retBm.toFixed(1)}%). Demonstrates high volunteer continuity.`
      );
    } else if (rawRet >= retBm * 0.6) {
      insights.push(
        `Retention is moderate (${rawRet.toFixed(1)}%): ${overlapCount.toLocaleString()} returning uploaders retained from ${baseCount.toLocaleString()} baseline. Tracking within typical range for annual photo contests (benchmark: ${retBm.toFixed(1)}%).`
      );
    } else {
      insights.push(
        `Retention indicates high turnover (${rawRet.toFixed(1)}%): retained ${overlapCount.toLocaleString()} of ${baseCount.toLocaleString()} baseline contributors (below ${regionLabel} of ${retBm.toFixed(1)}%). Characteristic of outreach drives where post-contest re-engagement is limited.`
      );
    }
  }

  // 2. Contributor Expansion Insight
  const rawGrowth = metrics.Growth?.newcomers_count ?? newcomerCount;
  const groBm = typeof benchmarks.expansion === 'number' ? benchmarks.expansion : (typeof benchmarks.growth === 'number' ? benchmarks.growth : null);
  if (groBm === null) {
    insights.push(
      `Newcomer recruitment: ${rawGrowth.toLocaleString()} first-time contributors joined the campaign.`
    );
  } else if (rawGrowth >= groBm) {
    insights.push(
      `Newcomer recruitment is exceptional (${rawGrowth.toLocaleString()} newcomers): exceeded the ${regionLabel} (${Math.round(groBm).toLocaleString()} newcomers), driving substantial volunteer expansion.`
    );
  } else if (rawGrowth >= groBm * 0.6) {
    insights.push(
      `Newcomer recruitment is steady (${rawGrowth.toLocaleString()} newcomers): maintains healthy volunteer onboarding tracking within peer range (benchmark: ${Math.round(groBm).toLocaleString()} newcomers).`
    );
  } else {
    insights.push(
      `Newcomer recruitment is constrained (${rawGrowth.toLocaleString()} newcomers): first-time contributors joined below the ${regionLabel} (${Math.round(groBm).toLocaleString()} newcomers), suggesting an opportunity to expand outreach channels.`
    );
  }

  // 3. Content Utility Insight
  const rawUsage = parseFloat(String(metrics.Usage?.raw || '0'));
  const useBm = typeof benchmarks.usage === 'number' ? benchmarks.usage : null;
  if (useBm === null) {
    insights.push(
      rawUsage > 0.0
        ? `Content Utility is ${rawUsage.toFixed(1)}%: uploaded files are active in Wikipedia article illustrations.`
        : 'Content Utility is unindexed (0.0%): no uploaded files are currently recorded in active Wikipedia article use.'
    );
  } else if (rawUsage >= useBm) {
    insights.push(
      `Content Utility is robust (${rawUsage.toFixed(1)}%): file reuse across Wikipedia articles matches or exceeds the ${regionLabel} (${useBm.toFixed(1)}%), delivering direct encyclopedic value.`
    );
  } else if (rawUsage > 0.0) {
    insights.push(
      `Content Utility is emerging (${rawUsage.toFixed(1)}%): files have begun being deployed in Wikipedia articles (benchmark: ${useBm.toFixed(1)}%). Encyclopedic adoption typically expands over 6–12 months via edit-a-thons.`
    );
  } else {
    insights.push(
      'Content Utility is unindexed (0.0%): no uploaded files are currently recorded in active Wikipedia article use. Suggests an organizing opportunity for post-contest illustration drives.'
    );
  }

  // 4. Diversity Insight
  const rawDiv = parseFloat(String(metrics.Diversity?.raw || '70'));
  const divBm = typeof benchmarks.diversity === 'number' ? benchmarks.diversity : null;
  if (rawDiv <= 65.0) {
    insights.push(
      `Participation breadth is exceptionally distributed: top 10% uploaders contributed ${rawDiv.toFixed(1)}% of files, demonstrating broad grassroots participation beyond the power-user core.`
    );
  } else if (rawDiv <= 85.0) {
    insights.push(
      `Participation distribution (${rawDiv.toFixed(1)}% by top 10% uploaders) aligns with standard Wikimedia peer-production power laws${divBm !== null ? ` (regional norm: ${divBm.toFixed(1)}%)` : ''}.`
    );
  } else {
    insights.push(
      `Upload concentration is high: top 10% uploaders contributed ${rawDiv.toFixed(1)}% of all submissions, indicating heavy reliance on a small cluster of power uploaders.`
    );
  }

  // 5. Quality Recognition Insight
  const rawQual = parseFloat(String(metrics.Quality?.raw || '0'));
  const qualBm = typeof benchmarks.quality === 'number' ? benchmarks.quality : null;
  if (qualBm === null) {
    insights.push(
      rawQual > 0.0
        ? `Quality Recognition: ${rawQual.toFixed(1)}% of submissions recognized as Commons Quality Images or Featured Pictures.`
        : 'Quality Recognition is unindexed (0.0%): no files have formal Commons Quality Image designations.'
    );
  } else if (rawQual >= qualBm) {
    insights.push(
      `Quality Recognition is high (${rawQual.toFixed(1)}%): formal Commons Quality Image / Featured Picture nominations outperform the ${regionLabel} (${qualBm.toFixed(1)}%).`
    );
  } else if (rawQual > 0.0) {
    insights.push(
      `Quality Recognition is present (${rawQual.toFixed(1)}%): recognized Commons quality files have been logged (benchmark: ${qualBm.toFixed(1)}%).`
    );
  } else {
    insights.push(
      'Quality Recognition is unindexed (0.0%): no files have formal Commons Quality Image designations. (Note: Commons QI requires manual jury/volunteer nominations).'
    );
  }

  // 6. Community Scale Insight
  const rawScale = metrics.Scale?.count ?? targetCount;
  const scaleBm = typeof benchmarks.scale === 'number' ? benchmarks.scale : null;
  if (scaleBm === null) {
    insights.push(
      `Community Scale is ${rawScale.toLocaleString()} active uploaders participating in this edition.`
    );
  } else if (rawScale >= scaleBm) {
    insights.push(
      `Community Scale is substantial (${rawScale.toLocaleString()} uploaders): cohort volume matches or exceeds the ${regionLabel} (${Math.round(scaleBm).toLocaleString()} uploaders), demonstrating major mobilization reach.`
    );
  } else if (rawScale >= scaleBm * 0.6) {
    insights.push(
      `Community Scale is healthy (${rawScale.toLocaleString()} uploaders): participant cohort represents solid community mobilization within typical peer parameters (benchmark: ${Math.round(scaleBm).toLocaleString()} uploaders).`
    );
  } else {
    insights.push(
      `Community Scale reflects an emerging cohort (${rawScale.toLocaleString()} uploaders): active participant volume is below the ${regionLabel} (${Math.round(scaleBm).toLocaleString()} uploaders), indicating scale disparity relative to established regional chapters.`
    );
  }

  return insights;
}

// =========================================================================
// CONTENT UTILITY DEEP ANALYSIS
// =========================================================================

export async function computeContentUtilityDeep(targetCampaign: string): Promise<any> {
  const clean = targetCampaign.replace(/\s+/g, '').toLowerCase();
  const m = CODE_RE.exec(clean);
  const evt = m ? m[1] : 'wlm';
  const cc = m ? m[2] : 'de';
  const yr = m ? 2000 + parseInt(m[3], 10) : 2024;
  const cName = countryDisplayName(cc);
  const eventName = EVENT_MAP[evt] || evt.toUpperCase();

  const users = await getParticipants(clean);
  const countsMap = await getParticipantsWithUploadCounts(clean);
  const totalUploads = Array.from(countsMap.values()).reduce((a, b) => a + b, 0);

  if (users.size === 0 || totalUploads === 0) {
    return {
      code: clean,
      year: yr,
      country: cName,
      event: eventName,
      global_utility_rate_pct: 0.0,
      usage_rate_pct: 0.0,
      total_global_usages: 0,
      unique_articles_count: 0,
      top_consuming_project: 'None',
      total_sampled: 0,
      total_uploads: 0,
      distinct_uploaders: 0,
      distinct_used_images: 0,
      distinct_articles: 0,
      cross_wiki_projects_count: 0,
      media_usages: [],
      top_photographers: []
    };
  }

  const primaryWiki = `${cc === 'de' ? 'de' : cc === 'it' ? 'it' : cc === 'fr' ? 'fr' : cc === 'es' ? 'es' : cc === 'bd' ? 'bn' : 'en'}.wikipedia.org`;

  if (evt === 'all') {
    const subCodes = getSubCampaignCodes(clean);
    let totalSampled = 0;
    let usedFilesCount = 0;
    let totalUsages = 0;
    const uniqueArticles = new Set<string>();
    const projectDist: Record<string, number> = {};
    const mediaUsages: any[] = [];
    const uploaderUtility: Record<string, { used_files: number; total_usages: number }> = {};
    const seenFiles = new Set<string>();

    for (const sub of subCodes) {
      const subRes = await computeContentUtilityDeep(sub);
      totalSampled += subRes.total_sampled || 0;
      usedFilesCount += subRes.distinct_used_images || 0;
      totalUsages += subRes.total_global_usages || 0;
      for (const mu of (subRes.media_usages || [])) {
        const fileKey = mu.full_title || mu.file_title;
        if (!seenFiles.has(fileKey)) {
          seenFiles.add(fileKey);
          if (mediaUsages.length < 25) {
            mediaUsages.push(mu);
          }
        }
      }
      for (const tp of (subRes.top_photographers || [])) {
        const u = tp.uploader || tp.username;
        if (!uploaderUtility[u]) {
          uploaderUtility[u] = { used_files: 0, total_usages: 0 };
        }
        uploaderUtility[u].used_files += tp.used_files_count || 0;
        uploaderUtility[u].total_usages += tp.total_usages || 0;
      }
    }

    const usageRate = totalSampled > 0 ? parseFloat(((usedFilesCount / totalSampled) * 100).toFixed(1)) : 0.0;
    const topProject = Object.keys(projectDist).sort((a, b) => projectDist[b] - projectDist[a])[0] || primaryWiki;

    const topPhotographers = Object.keys(uploaderUtility)
      .filter((u) => !isBotAccount(u))
      .sort((a, b) => uploaderUtility[b].total_usages - uploaderUtility[a].total_usages)
      .slice(0, 15)
      .map((u, i) => ({
        rank: i + 1,
        uploader: u,
        username: u,
        used_files_count: uploaderUtility[u].used_files,
        used_images_count: uploaderUtility[u].used_files,
        total_usages: uploaderUtility[u].total_usages,
        distinct_articles_count: uploaderUtility[u].used_files,
        primary_wiki: primaryWiki
      }));

    return {
      code: clean,
      year: yr,
      country: cName,
      event: 'All Campaigns',
      global_utility_rate_pct: usageRate,
      usage_rate_pct: usageRate,
      total_global_usages: totalUsages,
      unique_articles_count: uniqueArticles.size,
      top_consuming_project: topProject,
      total_sampled: totalSampled,
      total_uploads: totalUploads,
      distinct_uploaders: users.size,
      distinct_used_images: usedFilesCount,
      distinct_articles: uniqueArticles.size,
      cross_wiki_projects_count: Object.keys(projectDist).length,
      media_usages: mediaUsages,
      top_photographers: topPhotographers
    };
  }

  const categories = getCategoryCandidates(clean);

  let totalSampled = 0;
  let usedFilesCount = 0;
  let totalUsages = 0;
  const uniqueArticles = new Set<string>();
  const projectDist: Record<string, number> = {};
  const mediaUsages: any[] = [];
  const uploaderUtility: Record<string, { used_files: number; total_usages: number }> = {};

  for (const cat of categories) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);
      const url = `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=categorymembers&gcmtitle=Category:${encodeURIComponent(cat)}&gcmtype=file&gcmlimit=50&prop=imageinfo|globalusage&iiprop=user|url&iiurlwidth=300&gulimit=10`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'CampTools/1.0 (https://camptools.toolforge.org; tanvirsdq@toolforge.org)' },
        signal: controller.signal
      });
      clearTimeout(timeout);
      if (res.ok) {
        const data = await res.json();
        const pages = data?.query?.pages || {};
        for (const pid of Object.keys(pages)) {
          const p = pages[pid];
          totalSampled++;
          const title = p.title || '';
          const gu = p.globalusage || [];
          const ii = p.imageinfo && p.imageinfo[0] ? p.imageinfo[0] : {};
          const uploader = ii.user || 'Community Contributor';
          const thumbUrl = ii.thumburl || '';
          const descUrl = ii.descriptionurl || `https://commons.wikimedia.org/wiki/${encodeURIComponent(title.replace(/\s+/g, '_'))}`;

          if (gu.length > 0 && !isBotAccount(uploader)) {
            usedFilesCount++;
            totalUsages += gu.length;
            if (!uploaderUtility[uploader]) {
              uploaderUtility[uploader] = { used_files: 0, total_usages: 0 };
            }
            uploaderUtility[uploader].used_files++;
            uploaderUtility[uploader].total_usages += gu.length;

            for (const u of gu) {
              const wiki = u.wiki || 'unknown';
              const art = (u.title || '').replace(/_/g, ' ');
              projectDist[wiki] = (projectDist[wiki] || 0) + 1;
              uniqueArticles.add(`${wiki}:${art}`);
              if (mediaUsages.length < 25) {
                mediaUsages.push({
                  file_title: title.replace('File:', '').replace(/_/g, ' '),
                  full_title: title,
                  article: art,
                  wiki: wiki,
                  commons_url: descUrl,
                  thumb_url: thumbUrl
                });
              }
            }
          }
        }
      }
    } catch {
      // Network failure
    }
    if (totalSampled > 0) break;
  }

  const usageRate = totalSampled > 0 ? parseFloat(((usedFilesCount / totalSampled) * 100).toFixed(1)) : 0.0;
  const topProject = Object.keys(projectDist).sort((a, b) => projectDist[b] - projectDist[a])[0] || primaryWiki;

  const topPhotographers = Object.keys(uploaderUtility)
    .filter((u) => !isBotAccount(u))
    .sort((a, b) => uploaderUtility[b].total_usages - uploaderUtility[a].total_usages)
    .slice(0, 15)
    .map((u, i) => ({
      rank: i + 1,
      uploader: u,
      username: u,
      used_files_count: uploaderUtility[u].used_files,
      used_images_count: uploaderUtility[u].used_files,
      total_usages: uploaderUtility[u].total_usages,
      distinct_articles_count: uploaderUtility[u].used_files,
      primary_wiki: primaryWiki
    }));

  return {
    code: clean,
    year: yr,
    country: cName,
    event: eventName,
    global_utility_rate_pct: usageRate,
    usage_rate_pct: usageRate,
    total_global_usages: totalUsages,
    unique_articles_count: uniqueArticles.size,
    top_consuming_project: topProject,
    total_sampled: totalSampled,
    total_uploads: totalUploads,
    distinct_uploaders: users.size,
    distinct_used_images: usedFilesCount,
    distinct_articles: uniqueArticles.size,
    cross_wiki_projects_count: Object.keys(projectDist).length,
    media_usages: mediaUsages,
    top_photographers: topPhotographers
  };
}

// =========================================================================
// QUALITY RECOGNITION DEEP ANALYSIS
// =========================================================================

export async function computeQualityRecognitionDeep(targetCampaign: string): Promise<any> {
  const clean = targetCampaign.replace(/\s+/g, '').toLowerCase();
  const m = CODE_RE.exec(clean);
  const evt = m ? m[1] : 'wlm';
  const cc = m ? m[2] : 'de';
  const yr = m ? 2000 + parseInt(m[3], 10) : 2024;
  const cName = countryDisplayName(cc);
  const eventName = EVENT_MAP[evt] || evt.toUpperCase();

  const users = await getParticipants(clean);
  const countsMap = await getParticipantsWithUploadCounts(clean);
  const totalUploads = Array.from(countsMap.values()).reduce((a, b) => a + b, 0);

  if (users.size === 0 || totalUploads === 0) {
    return {
      code: clean,
      year: yr,
      country: cName,
      event: eventName,
      total_uploads: 0,
      quality_rate_pct: 0.0,
      qi_count: 0,
      fp_count: 0,
      vi_count: 0,
      honored_photographers_count: 0,
      recognized_count: 0,
      recognized_files: [],
      leaderboard: []
    };
  }

  if (evt === 'all') {
    const subCodes = getSubCampaignCodes(clean);
    let qiCount = 0;
    let fpCount = 0;
    let viCount = 0;
    const recognizedFiles: any[] = [];
    const uploaderHonors: Record<string, { qi: number; fp: number; vi: number }> = {};
    const seenTitles = new Set<string>();

    for (const sub of subCodes) {
      const subRes = await computeQualityRecognitionDeep(sub);
      qiCount += subRes.qi_count || 0;
      fpCount += subRes.fp_count || 0;
      viCount += subRes.vi_count || 0;
      for (const rf of (subRes.recognized_files || [])) {
        if (!seenTitles.has(rf.title)) {
          seenTitles.add(rf.title);
          recognizedFiles.push(rf);
        }
      }
      for (const lb of (subRes.leaderboard || [])) {
        const u = lb.uploader || lb.username;
        if (!uploaderHonors[u]) {
          uploaderHonors[u] = { qi: 0, fp: 0, vi: 0 };
        }
        uploaderHonors[u].qi += lb.qi_count || 0;
        uploaderHonors[u].fp += lb.fp_count || 0;
        uploaderHonors[u].vi += lb.vi_count || 0;
      }
    }

    const totalRecognized = fpCount + qiCount + viCount;
    const qualityRate = totalUploads > 0 ? parseFloat(((totalRecognized / totalUploads) * 100).toFixed(2)) : 0.0;

    const leaderboard = Object.keys(uploaderHonors)
      .filter((u) => !isBotAccount(u))
      .sort((a, b) => (uploaderHonors[b].qi + uploaderHonors[b].fp) - (uploaderHonors[a].qi + uploaderHonors[a].fp))
      .slice(0, 10)
      .map((u, i) => ({
        rank: i + 1,
        uploader: u,
        username: u,
        total_honors: uploaderHonors[u].qi + uploaderHonors[u].fp + uploaderHonors[u].vi,
        qi_count: uploaderHonors[u].qi,
        fp_count: uploaderHonors[u].fp,
        vi_count: uploaderHonors[u].vi,
        recognized_files_count: uploaderHonors[u].qi + uploaderHonors[u].fp + uploaderHonors[u].vi,
        quality_share_pct: totalUploads > 0 ? parseFloat(((uploaderHonors[u].qi / totalUploads) * 100).toFixed(1)) : 0.0
      }));

    return {
      code: clean,
      year: yr,
      country: cName,
      event: 'All Campaigns',
      total_uploads: totalUploads,
      quality_rate_pct: qualityRate,
      qi_count: qiCount,
      fp_count: fpCount,
      vi_count: viCount,
      honored_photographers_count: leaderboard.length,
      recognized_count: recognizedFiles.length,
      recognized_files: recognizedFiles.slice(0, 30),
      leaderboard: leaderboard
    };
  }

  const categories = getCategoryCandidates(clean);
  let qiCount = 0;
  let fpCount = 0;
  let viCount = 0;
  const recognizedFiles: any[] = [];
  const uploaderHonors: Record<string, { qi: number; fp: number; vi: number }> = {};

  for (const cat of categories) {
    const catClean = cat.replace(/_/g, ' ');
    const qiCandidates = [
      catClean.replace('Images from ', 'Quality images from '),
      `Quality images from ${catClean.replace('Images from ', '')}`,
      `Quality images from ${catClean}`
    ];

    for (const qcat of qiCandidates) {
      if (qcat === catClean || qcat === cat) continue;
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const res = await fetch(
          `https://commons.wikimedia.org/w/api.php?action=query&titles=Category:${encodeURIComponent(qcat)}&prop=categoryinfo&format=json`,
          {
            headers: { 'User-Agent': 'CampTools/1.0 (https://camptools.toolforge.org; tanvirsdq@toolforge.org)' },
            signal: controller.signal
          }
        );
        clearTimeout(timeout);
        if (res.ok) {
          const data = await res.json();
          const pages = data?.query?.pages || {};
          for (const pid of Object.keys(pages)) {
            const cinfo = pages[pid]?.categoryinfo;
            if (cinfo && cinfo.files > 0) {
              qiCount = cinfo.files;
              // Fetch a sample of real recognized files
              const fController = new AbortController();
              const fTimeout = setTimeout(() => fController.abort(), 6000);
              const fRes = await fetch(
                `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=categorymembers&gcmtitle=Category:${encodeURIComponent(qcat)}&gcmtype=file&gcmlimit=25&prop=imageinfo&iiprop=user|timestamp|url&iiurlwidth=300`,
                {
                  headers: { 'User-Agent': 'CampTools/1.0 (https://camptools.toolforge.org; tanvirsdq@toolforge.org)' },
                  signal: fController.signal
                }
              );
              clearTimeout(fTimeout);
              if (fRes.ok) {
                const fData = await fRes.json();
                const fPages = fData?.query?.pages || {};
                for (const fPid of Object.keys(fPages)) {
                  const fpObj = fPages[fPid];
                  const title = fpObj.title || '';
                  const ii = fpObj.imageinfo && fpObj.imageinfo[0] ? fpObj.imageinfo[0] : {};
                  const uploader = ii.user || 'Photographer';
                  const thumb = ii.thumburl || '';
                  const commonsUrl = `https://commons.wikimedia.org/wiki/${encodeURIComponent(title.replace(/\s+/g, '_'))}`;

                  recognizedFiles.push({
                    title,
                    file_title: title,
                    thumb_url: thumb,
                    honors: ['Quality Image'],
                    uploader,
                    commons_url: commonsUrl,
                    details: 'Certified as Quality Image on Wikimedia Commons.'
                  });

                  if (!uploaderHonors[uploader]) {
                    uploaderHonors[uploader] = { qi: 0, fp: 0, vi: 0 };
                  }
                  uploaderHonors[uploader].qi++;
                }
              }
              break;
            }
          }
        }
      } catch {
        // Fall through
      }
      if (qiCount > 0) break;
    }
    if (qiCount > 0) break;
  }

  const totalRecognized = fpCount + qiCount + viCount;
  const qualityRate = totalUploads > 0 ? parseFloat(((totalRecognized / totalUploads) * 100).toFixed(2)) : 0.0;

  const leaderboard = Object.keys(uploaderHonors)
    .filter((u) => !isBotAccount(u))
    .sort((a, b) => (uploaderHonors[b].qi + uploaderHonors[b].fp) - (uploaderHonors[a].qi + uploaderHonors[a].fp))
    .slice(0, 10)
    .map((u, i) => ({
      rank: i + 1,
      uploader: u,
      username: u,
      total_honors: uploaderHonors[u].qi + uploaderHonors[u].fp + uploaderHonors[u].vi,
      qi_count: uploaderHonors[u].qi,
      fp_count: uploaderHonors[u].fp,
      vi_count: uploaderHonors[u].vi,
      recognized_files_count: uploaderHonors[u].qi + uploaderHonors[u].fp + uploaderHonors[u].vi,
      quality_share_pct: totalUploads > 0 ? parseFloat(((uploaderHonors[u].qi / totalUploads) * 100).toFixed(1)) : 0.0
    }));

  return {
    code: clean,
    year: yr,
    country: cName,
    event: eventName,
    total_uploads: totalUploads,
    quality_rate_pct: qualityRate,
    qi_count: qiCount,
    fp_count: fpCount,
    vi_count: viCount,
    honored_photographers_count: leaderboard.length,
    recognized_count: recognizedFiles.length,
    recognized_files: recognizedFiles,
    leaderboard: leaderboard
  };
}

export function resolveRegionName(input?: string, fallbackCc?: string): string {
  if (input) {
    const trimmed = input.trim();
    if (trimmed && REGION_COUNTRY_MAPPING[trimmed]) {
      return trimmed;
    }
    const lower = trimmed.toLowerCase();
    for (const reg of Object.keys(REGION_COUNTRY_MAPPING)) {
      if (reg.toLowerCase() === lower) return reg;
    }
    // Substring match in either direction
    for (const reg of Object.keys(REGION_COUNTRY_MAPPING)) {
      const regLower = reg.toLowerCase();
      if (regLower.includes(lower) || lower.includes(regLower)) return reg;
    }
    // Common regional aliases & clusters
    if (lower.includes('south asia') || lower.includes('south-asia')) return 'South Asia';
    if (lower.includes('east') && lower.includes('asia')) return 'East, Southeast Asia, Pacific';
    if (lower.includes('asia') || lower.includes('pacific')) return 'South Asia';
    if (lower.includes('central') && lower.includes('europe')) return 'Central & Eastern Europe';
    if (lower.includes('eastern') && lower.includes('europe')) return 'Central & Eastern Europe';
    if (lower.includes('southern') && lower.includes('europe')) return 'Southern Europe';
    if (lower.includes('europe') || lower.includes('eur')) return 'Northern & Western Europe';
    if (lower.includes('mena') || lower.includes('middle east')) return 'Middle East & North Africa';
    if (lower.includes('latin') || lower.includes('caribbean')) return 'Latin America & Caribbean';
    if (lower.includes('africa')) return 'Sub-Saharan Africa';
    if (lower.includes('north america')) return 'North America';
  }
  if (fallbackCc && COUNTRY_TO_REGION[fallbackCc.toLowerCase()]) {
    return COUNTRY_TO_REGION[fallbackCc.toLowerCase()];
  }
  return 'Northern & Western Europe';
}

export async function computeHealthEvaluation(
  targetEvent: string,
  regionInput?: string
): Promise<HealthEvaluationResult> {
  const match = CODE_RE.exec(targetEvent.toLowerCase());
  if (!match) throw new Error(`Invalid campaign code format '${targetEvent}'`);
  const [, eventType, targetCc, yearStr] = match;
  const yearInt = parseInt(yearStr, 10);
  const prevYearStr = String((yearInt - 1 + 100) % 100).padStart(2, '0');
  const region = resolveRegionName(regionInput, targetCc);
  const baselineEvent = `${eventType}${targetCc}${prevYearStr}`;
  const isAll = eventType === 'all';

  // Collect chronological past 3-5 years for longitudinal trajectory
  const pastYears: number[] = [];
  for (let y = yearInt; y >= Math.max(yearInt - 4, 10); y--) {
    pastYears.push(y);
  }
  pastYears.reverse();

  const regionalCountries = REGION_COUNTRY_MAPPING[region] || [];
  const scanPool = new Set<string>();
  for (const cc of regionalCountries) {
    scanPool.add(`${eventType}${cc}${yearStr}`);
    scanPool.add(`${eventType}${cc}${prevYearStr}`);
  }
  for (const y of pastYears) {
    scanPool.add(`${eventType}${targetCc}${String(y % 100).padStart(2, '0')}`);
  }
  scanPool.add(baselineEvent.toLowerCase());
  scanPool.add(targetEvent.toLowerCase());

  const allFetched = await fetchAllConcurrently(Array.from(scanPool));
  const targetUsers = allFetched[targetEvent.toLowerCase()] || new Set<string>();
  const baseUsers = allFetched[baselineEvent.toLowerCase()] || new Set<string>();

  if (targetUsers.size === 0) {
    throw new Error(`Campaign '${targetEvent}' did not take place or has no recorded uploads on Wikimedia Commons. It cannot be evaluated.`);
  }

  const heldPeers = regionalCountries
    .map((cc) => ({ cc, count: (allFetched[`${eventType}${cc}${yearStr}`] || new Set()).size }))
    .filter((p) => p.count > 0 && p.cc.toLowerCase() !== targetCc.toLowerCase());
  heldPeers.sort((a, b) => b.count - a.count);
  const top3 = heldPeers.slice(0, 3).map((p) => p.cc);

  const structuralCodes = top3.map((cc) => `${eventType}${cc}${yearStr}`);
  structuralCodes.push(targetEvent.toLowerCase());
  structuralCodes.push(baselineEvent.toLowerCase());
  for (const y of pastYears) {
    structuralCodes.push(`${eventType}${targetCc}${String(y % 100).padStart(2, '0')}`);
  }
  const structuralMetrics = await fetchStructuralMetricsConcurrently(Array.from(new Set(structuralCodes)));

  const repRetentions: number[] = [];
  const repGrowths: number[] = [];
  const repScales: number[] = [];
  const repQualityRates: number[] = [];
  const repQualityCounts: number[] = [];
  const repDiversities: number[] = [];
  const repUsages: number[] = [];
  const repUsageCounts: number[] = [];

  for (const cc of top3) {
    const tCode = `${eventType}${cc}${yearStr}`;
    const bCode = `${eventType}${cc}${prevYearStr}`;
    const tU = allFetched[tCode] || new Set<string>();
    const bU = allFetched[bCode] || new Set<string>();
    const struct = structuralMetrics[tCode] || {};

    if (tU.size > 0) {
      repScales.push(tU.size);
    }

    if (bU.size > 0) {
      let o = 0;
      for (const u of tU) if (bU.has(u)) o++;
      repRetentions.push((o / bU.size) * 100);
    }

    if (tU.size > 0) {
      let n = 0;
      for (const u of tU) if (!bU.has(u)) n++;
      repGrowths.push(n);

      const estUploads = struct.total_uploads || 0;
      if (struct.quality_image_share !== undefined) {
        repQualityRates.push(struct.quality_image_share);
        repQualityCounts.push(Math.round((estUploads * struct.quality_image_share) / 100));
      }
      if (struct.top10_uploader_share !== undefined) {
        repDiversities.push(struct.top10_uploader_share);
      }
      if (struct.usage_share !== undefined) {
        repUsages.push(struct.usage_share);
        repUsageCounts.push(Math.round((estUploads * struct.usage_share) / 100));
      }
    }
  }

  const benchmarks: HealthBenchmarks = {
    retention: computeEmpiricalMedian(repRetentions),
    growth: computeEmpiricalMedian(repGrowths),
    expansion: computeEmpiricalMedian(repGrowths),
    newcomers: computeEmpiricalMedian(repGrowths),
    quality: computeEmpiricalMedian(repQualityRates),
    quality_count: computeEmpiricalMedian(repQualityCounts),
    diversity: computeEmpiricalMedian(repDiversities),
    usage: computeEmpiricalMedian(repUsages),
    usage_count: computeEmpiricalMedian(repUsageCounts),
    scale: computeEmpiricalMedian(repScales)
  };

  const targetStructural = structuralMetrics[targetEvent.toLowerCase()] || {
    quality_image_share: 0.0,
    top10_uploader_share: 100.0,
    usage_share: 0.0,
    total_uploads: 0
  };
  const baseStructural = structuralMetrics[baselineEvent.toLowerCase()] || {};

  const metrics = generateHealthMetrics(targetUsers, baseUsers, targetStructural, benchmarks, baseStructural);
  let overlap = 0;
  for (const u of targetUsers) if (baseUsers.has(u)) overlap++;

  // Build Multi-Year Longitudinal Historical Series
  const historicalSeries: HistoricalEditionPoint[] = [];
  let priorSet: Set<string> | null = null;
  for (const y of pastYears) {
    const cCode = `${eventType}${targetCc}${String(y % 100).padStart(2, '0')}`;
    const uSet = allFetched[cCode] || new Set<string>();
    if (uSet.size === 0) continue;
    const struct = structuralMetrics[cCode] || {};
    const uploads = struct.total_uploads || 0;
    let retained = 0;
    let newcomers = uSet.size;
    let retPct: number | null = null;

    if (priorSet && priorSet.size > 0) {
      for (const u of uSet) {
        if (priorSet.has(u)) retained++;
      }
      newcomers = Math.max(0, uSet.size - retained);
      retPct = parseFloat(((retained / priorSet.size) * 100).toFixed(1));
    }
    const qCount = Math.round((uploads * (struct.quality_image_share || 0)) / 100);
    const uCount = Math.round((uploads * (struct.usage_share || 0)) / 100);

    historicalSeries.push({
      year: 2000 + y,
      code: cCode,
      uploaders: uSet.size,
      uploads,
      newcomers,
      retained,
      retention_pct: retPct,
      quality_count: qCount,
      usage_count: uCount
    });
    priorSet = uSet;
  }

  // Build Regional Peer Comparisons
  const peerComparisons: PeerComparisonPoint[] = [];
  const targetUploads = targetStructural.total_uploads || 0;
  const targetRetPct = baseUsers.size > 0 ? parseFloat(((overlap / baseUsers.size) * 100).toFixed(1)) : null;

  peerComparisons.push({
    country: countryDisplayName(targetCc),
    country_code: targetCc.toUpperCase(),
    code: targetEvent.toLowerCase(),
    uploaders: targetUsers.size,
    uploads: targetUploads,
    retention_pct: targetRetPct,
    quality_count: Math.round((targetUploads * (targetStructural.quality_image_share || 0)) / 100),
    usage_count: Math.round((targetUploads * (targetStructural.usage_share || 0)) / 100)
  });

  for (const cc of top3) {
    const pCode = `${eventType}${cc}${yearStr}`;
    const pbCode = `${eventType}${cc}${prevYearStr}`;
    const pUsers = allFetched[pCode] || new Set<string>();
    const pbUsers = allFetched[pbCode] || new Set<string>();
    if (pUsers.size === 0) continue;
    const pStruct = structuralMetrics[pCode] || {};
    const pUploads = pStruct.total_uploads || 0;
    let pOverlap = 0;
    for (const u of pUsers) if (pbUsers.has(u)) pOverlap++;
    const pRetPct = pbUsers.size > 0 ? parseFloat(((pOverlap / pbUsers.size) * 100).toFixed(1)) : null;

    peerComparisons.push({
      country: countryDisplayName(cc),
      country_code: cc.toUpperCase(),
      code: pCode,
      uploaders: pUsers.size,
      uploads: pUploads,
      retention_pct: pRetPct,
      quality_count: Math.round((pUploads * (pStruct.quality_image_share || 0)) / 100),
      usage_count: Math.round((pUploads * (pStruct.usage_share || 0)) / 100)
    });
  }

  const newcomerCount = Math.max(0, targetUsers.size - overlap);
  const newcomerPct = targetUsers.size > 0 ? parseFloat(((newcomerCount / targetUsers.size) * 100).toFixed(1)) : 0;
  const retentionPct = baseUsers.size > 0 ? parseFloat(((overlap / baseUsers.size) * 100).toFixed(1)) : 0;
  const totalUploadsEst = targetStructural.total_uploads || 0;
  const usageShare = targetStructural.usage_share || 0;
  const qualityShare = targetStructural.quality_image_share || 0;

  let compositeScore: number | null = null;
  let tier: string | null = null;
  let stars: [string, number] | null = null;
  let ratingLabel: string | null = null;

  const scoredDimensions: { score: number; weight: number }[] = [];
  if (benchmarks.growth !== null && metrics.Growth?.count !== undefined) {
    const groScore = calculateRelativeScore(metrics.Growth.count, benchmarks.growth, true, true);
    scoredDimensions.push({ score: groScore, weight: 25 });
  }
  if (!metrics.Retention?.is_inaugural && benchmarks.retention !== null && typeof metrics.Retention?.yoy_delta_pct === 'number') {
    const retScore = calculateRelativeScore(metrics.Retention.yoy_delta_pct, benchmarks.retention, true);
    scoredDimensions.push({ score: retScore, weight: 25 });
  }
  if (benchmarks.usage !== null && typeof metrics.Usage?.raw === 'number') {
    const useScore = calculateRelativeScore(metrics.Usage.raw, benchmarks.usage, true);
    scoredDimensions.push({ score: useScore, weight: 20 });
  }
  if (benchmarks.quality !== null && typeof metrics.Quality?.raw === 'number') {
    const qualScore = calculateRelativeScore(metrics.Quality.raw, benchmarks.quality, true);
    scoredDimensions.push({ score: qualScore, weight: 15 });
  }
  if (benchmarks.diversity !== null && typeof metrics.Diversity?.raw === 'number') {
    const divScore = calculateRelativeScore(metrics.Diversity.raw, benchmarks.diversity, false);
    scoredDimensions.push({ score: divScore, weight: 15 });
  }

  if (scoredDimensions.length > 0) {
    const totalWeight = scoredDimensions.reduce((sum, d) => sum + d.weight, 0);
    const weightedSum = scoredDimensions.reduce((sum, d) => sum + d.score * d.weight, 0);
    compositeScore = Math.round(weightedSum / totalWeight);
    tier = compositeScore >= 80 ? 'Tier 1' : compositeScore >= 60 ? 'Tier 2' : 'Tier 3';
    stars = calculateStars(compositeScore);
    ratingLabel = compositeScore >= 85 ? 'Outstanding' : compositeScore >= 70 ? 'Strong' : compositeScore >= 50 ? 'Moderate' : compositeScore >= 30 ? 'Emerging' : 'Critical / Low';
  }

  const overallReport: OverallCampaignReport = {
    campaign_code: targetEvent.toLowerCase(),
    campaign_name: EVENT_MAP[eventType] ? `Wiki Loves ${EVENT_MAP[eventType]}` : eventType.toUpperCase(),
    country_name: countryDisplayName(targetCc),
    country_code: targetCc.toUpperCase(),
    edition_year: 2000 + yearInt,
    region,
    generated_date: new Date().toISOString().split('T')[0],
    composite_score: compositeScore,
    tier: tier ?? undefined,
    rating_label: ratingLabel ?? undefined,
    stars: stars ?? undefined,
    total_uploaders: targetUsers.size,
    newcomer_uploaders: newcomerCount,
    returning_uploaders: overlap,
    newcomer_share_pct: newcomerPct,
    baseline_code: baselineEvent.toLowerCase(),
    baseline_uploaders: baseUsers.size,
    retained_uploaders: overlap,
    retention_rate_pct: retentionPct,
    total_uploads: totalUploadsEst,
    usage_share_pct: usageShare,
    articles_illustrated_estimate: Math.round((totalUploadsEst * usageShare) / 100),
    quality_image_share_pct: qualityShare,
    quality_images_estimate: Math.round((totalUploadsEst * qualityShare) / 100),
    top10_uploader_share_pct: targetUsers.size > 0 ? (targetStructural.top10_uploader_share ?? 0) : 0,
    dimensions: metrics,
    benchmarks,
    historical_series: historicalSeries,
    peer_comparisons: peerComparisons,
    insights: []
  };

  return {
    target_campaign: targetEvent.toLowerCase(),
    baseline_campaign: baselineEvent.toLowerCase(),
    region,
    target_users_count: targetUsers.size,
    baseline_users_count: baseUsers.size,
    overlap_users_count: overlap,
    dimensions: metrics,
    benchmarks,
    historical_series: historicalSeries,
    peer_comparisons: peerComparisons,
    overall_report: overallReport
  };
}

// =========================================================================
// MULTI-COUNTRY COMPARATIVE ANALYTICS ENGINE
// =========================================================================

export async function computeComparativeAnalytics(
  params: ComparativeParams
): Promise<ComparativeAnalyticsResult> {
  const module = params.module || 'influx';
  const eventType = (params.eventType || 'wlm').trim().toLowerCase();
  const currentYear = new Date().getFullYear();
  const currentY = currentYear - 1;
  const defaultStart = Math.max(2010, currentY - 4);

  let startYear = Number.isInteger(params.startYear) ? params.startYear : defaultStart;
  let endYear = Number.isInteger(params.endYear) ? params.endYear : currentY;

  // Clamp years
  startYear = Math.max(2010, Math.min(currentYear, startYear));
  endYear = Math.max(2010, Math.min(currentYear, endYear));
  if (startYear > endYear) {
    const tmp = startYear;
    startYear = endYear;
    endYear = tmp;
  }

  // Sanitize country codes
  const rawCodes = Array.isArray(params.countryCodes)
    ? params.countryCodes
    : (typeof params.countryCodes === 'string' ? [params.countryCodes] : []);
  let requestedCountries = rawCodes
    .filter((c): c is string => typeof c === 'string')
    .map((c) => c.trim().toLowerCase())
    .filter((c) => Boolean(COUNTRY_MAP[c]));

  // Remove duplicates while preserving order
  requestedCountries = Array.from(new Set(requestedCountries));

  // Filter scoped campaigns (e.g. wlb, wla)
  requestedCountries = requestedCountries.filter((c) => !getCampaignScopeNotice(eventType, c));

  // Sensible defaults if empty
  if (requestedCountries.length === 0) {
    if (eventType === 'wlb') {
      requestedCountries = ['bd', 'in'];
    } else if (eventType === 'wla') {
      requestedCountries = ['ng', 'gh', 'ke', 'za', 'tz', 'ug'].filter((c) => COUNTRY_MAP[c]);
    } else {
      requestedCountries = ['de', 'it', 'fr', 'es', 'ua', 'pl'].filter((c) => COUNTRY_MAP[c]);
    }
  }

  const years: number[] = [];
  for (let y = startYear; y <= endYear; y++) {
    years.push(y);
  }

  // Pre-fetch codes: from startYear - 1 up to endYear (for historical continuity)
  const fetchStart = Math.max(2010, startYear - 1);
  const allCodes: string[] = [];
  for (const cc of requestedCountries) {
    for (let y = fetchStart; y <= endYear; y++) {
      allCodes.push(`${eventType}${cc}${String(y % 100).padStart(2, '0')}`);
    }
  }

  // Concurrent batch fetching
  const participantResults = await fetchAllConcurrently(allCodes);

  // If quality, utility, or diversity, fetch deep analyses concurrently
  const qualityResults: Record<string, any> = {};
  const utilityResults: Record<string, any> = {};
  const diversityResults: Record<string, DiversityRecord> = {};

  if (module === 'quality') {
    await mapConcurrent(allCodes, 6, async (code) => {
      qualityResults[code] = await computeQualityRecognitionDeep(code);
    });
  } else if (module === 'utility') {
    await mapConcurrent(allCodes, 6, async (code) => {
      utilityResults[code] = await computeContentUtilityDeep(code);
    });
  } else if (module === 'diversity') {
    const diversityTasks: Array<{ cc: string; y: number }> = [];
    for (const cc of requestedCountries) {
      for (const y of years) {
        diversityTasks.push({ cc, y });
      }
    }
    await mapConcurrent(diversityTasks, 6, async (task) => {
      const rec = await computeSingleDiversityRecord(eventType, task.cc, task.y);
      diversityResults[`${task.cc}_${task.y}`] = rec;
    });
  }

  // Construct series per country
  const series: CountrySeries[] = [];

  for (let cIdx = 0; cIdx < requestedCountries.length; cIdx++) {
    const cc = requestedCountries[cIdx];
    const color = CODEX_COLOR_PALETTE[cIdx % CODEX_COLOR_PALETTE.length];
    const points: TimeSeriesPoint[] = [];

    if (module === 'influx') {
      // Historical seen pool starting before startYear
      const seenPrior = new Set<string>();
      if (startYear - 1 >= 2010) {
        const priorCode = `${eventType}${cc}${String((startYear - 1) % 100).padStart(2, '0')}`;
        const priorUsers = participantResults[priorCode] || new Set<string>();
        for (const u of priorUsers) seenPrior.add(u);
      }

      for (const y of years) {
        const code = `${eventType}${cc}${String(y % 100).padStart(2, '0')}`;
        const currentUsers = participantResults[code] || new Set<string>();
        const totalActive = currentUsers.size;

        if (totalActive === 0) {
          points.push({
            year: y,
            value: 0,
            formatted_value: '0',
            code,
            is_baseline: y === startYear
          });
          continue;
        }

        let newUsers = 0;
        let returningUsers = 0;
        for (const u of currentUsers) {
          if (seenPrior.has(u)) {
            returningUsers++;
          } else {
            newUsers++;
          }
        }

        const isBaseline = y === startYear && (startYear - 1 < 2010 || seenPrior.size === 0);
        for (const u of currentUsers) seenPrior.add(u);

        let val: number;
        let fVal: string;
        if (params.metricKey === 'total_active' || params.metricKey === 'active') {
          val = totalActive;
          fVal = val.toLocaleString();
        } else if (params.metricKey === 'newcomer_share_pct' || params.metricKey === 'newcomer_share') {
          val = parseFloat(((newUsers / totalActive) * 100).toFixed(1));
          fVal = `${val.toFixed(1)}%`;
        } else {
          // Default: newcomers count
          val = newUsers;
          fVal = val.toLocaleString();
        }

        points.push({
          year: y,
          value: val,
          formatted_value: fVal,
          code,
          is_baseline: isBaseline
        });
      }
    } else if (module === 'retention') {
      for (const y of years) {
        const code = `${eventType}${cc}${String(y % 100).padStart(2, '0')}`;
        const prevCode = `${eventType}${cc}${String((y - 1) % 100).padStart(2, '0')}`;
        const currentUsers = participantResults[code] || new Set<string>();
        const prevUsers = participantResults[prevCode] || new Set<string>();

        let val: number | null = null;
        let fVal = '—';

        if (prevUsers.size > 0 && currentUsers.size > 0) {
          let overlap = 0;
          for (const u of currentUsers) {
            if (prevUsers.has(u)) overlap++;
          }
          val = parseFloat(((overlap / prevUsers.size) * 100).toFixed(1));
          fVal = `${val.toFixed(1)}%`;
        } else if (currentUsers.size > 0) {
          // No prior edition data available to measure retention against
          val = null;
          fVal = '—';
        }

        points.push({
          year: y,
          value: val,
          formatted_value: fVal,
          code,
          is_baseline: y === startYear
        });
      }
    } else if (module === 'quality') {
      for (const y of years) {
        const code = `${eventType}${cc}${String(y % 100).padStart(2, '0')}`;
        const qData = qualityResults[code];
        let val: number = 0;
        let fVal = '0';

        if (qData) {
          if (params.metricKey === 'quality_rate_pct' || params.metricKey === 'quality_rate') {
            val = qData.quality_rate_pct;
            fVal = `${val.toFixed(2)}%`;
          } else {
            // Default: total honors
            val = qData.qi_count + qData.fp_count + qData.vi_count;
            fVal = val.toLocaleString();
          }
        }

        points.push({
          year: y,
          value: val,
          formatted_value: fVal,
          code
        });
      }
    } else if (module === 'utility') {
      for (const y of years) {
        const code = `${eventType}${cc}${String(y % 100).padStart(2, '0')}`;
        const uData = utilityResults[code];
        let val: number = 0;
        let fVal = '0';

        if (uData) {
          if (
            params.metricKey === 'utility_rate' ||
            params.metricKey === 'utility_rate_pct' ||
            params.metricKey === 'global_utility_rate' ||
            params.metricKey === 'global_utility_rate_pct'
          ) {
            val = uData.global_utility_rate_pct;
            fVal = `${val.toFixed(1)}%`;
          } else {
            // Default: total global usages
            val = uData.total_global_usages;
            fVal = val.toLocaleString();
          }
        }

        points.push({
          year: y,
          value: val,
          formatted_value: fVal,
          code
        });
      }
    } else if (module === 'diversity') {
      const isTop10 = params.metricKey === 'top_10_percent_share' || params.metricKey === 'top10_share';
      for (const y of years) {
        const code = `${eventType}${cc}${String(y % 100).padStart(2, '0')}`;
        const rec = diversityResults[`${cc}_${y}`];
        let val: number = 0;
        let fVal = '0';
        if (rec) {
          if (isTop10) {
            val = rec.top_10_percent_share;
            fVal = `${val.toFixed(1)}%`;
          } else {
            val = rec.gini_coefficient;
            fVal = val.toFixed(3);
          }
        }
        points.push({
          year: y,
          value: val,
          formatted_value: fVal,
          code
        });
      }
    }

    // Compute summary stats
    const validPoints = points.filter((p) => p.value !== null);
    const latestPoint = validPoints.length > 0 ? validPoints[validPoints.length - 1] : null;
    const latestYear = latestPoint ? latestPoint.year : endYear;
    const latestValue = latestPoint ? latestPoint.value! : 0;
    const minValue = validPoints.length > 0 ? Math.min(...validPoints.map((p) => p.value!)) : 0;
    const maxValue = validPoints.length > 0 ? Math.max(...validPoints.map((p) => p.value!)) : 0;
    const avgValue = validPoints.length > 0
      ? parseFloat((validPoints.reduce((sum, p) => sum + p.value!, 0) / validPoints.length).toFixed(1))
      : 0;

    let yoyChangePct: number | null = null;
    if (validPoints.length >= 2) {
      const prevVal = validPoints[validPoints.length - 2].value!;
      if (prevVal > 0) {
        yoyChangePct = parseFloat((((latestValue - prevVal) / prevVal) * 100).toFixed(1));
      }
    }

    series.push({
      country_code: cc,
      country_name: countryDisplayName(cc),
      color,
      points,
      summary: {
        latest_year: latestYear,
        latest_value: latestValue,
        min_value: minValue,
        max_value: maxValue,
        avg_value: avgValue,
        yoy_change_pct: yoyChangePct
      }
    });
  }

  // Build ComparativeTableRow[]
  const tableRows: ComparativeTableRow[] = series.map((s) => {
    const values: Record<number, number | null> = {};
    const formatted_values: Record<number, string> = {};
    for (const pt of s.points) {
      values[pt.year] = pt.value;
      formatted_values[pt.year] = pt.formatted_value;
    }
    return {
      country_code: s.country_code,
      country_name: s.country_name,
      values,
      formatted_values,
      latest: s.summary.latest_value,
      average: s.summary.avg_value,
      yoy_change: s.summary.yoy_change_pct
    };
  });

  const headers = ['Country', ...years.map(String), 'Latest', 'Average', 'YoY Change'];

  // Build map_timeline_data
  const mapTimelineData: Record<number, MapTimelinePoint[]> = {};
  for (const y of years) {
    mapTimelineData[y] = [];
    for (const s of series) {
      const pt = s.points.find((p) => p.year === y);
      if (pt && pt.value !== null) {
        mapTimelineData[y].push({
          country_code: s.country_code,
          country_name: s.country_name,
          value: pt.value,
          formatted_value: pt.formatted_value
        });
      }
    }
  }

  // Construct IndicatorMetadata
  let meta: IndicatorMetadata;
  if (module === 'influx') {
    const isShare = params.metricKey === 'newcomer_share_pct' || params.metricKey === 'newcomer_share';
    const isActive = params.metricKey === 'total_active' || params.metricKey === 'active';
    meta = {
      indicator_id: isShare ? 'influx_share' : isActive ? 'influx_active' : 'influx_newcomers',
      title: isShare ? 'Newcomer Share of Participants' : isActive ? 'Active Campaign Participants' : 'New Participant Influx',
      definition: isShare
        ? 'Percentage of active campaign participants uploading files for the first time in the campaign series.'
        : isActive
        ? 'Total distinct participants who uploaded at least one media file during the annual campaign edition.'
        : 'Total number of first-time campaign participants who had not uploaded files in any prior observed edition.',
      data_source: 'Wikimedia Commons Category Members API & Toolforge Database',
      metric_unit: isShare ? '%' : 'Contributors',
      coverage: 'Annual national campaign editions (2010–present)',
      license: 'CC BY-SA 4.0',
      methodology_notes: [
        'Evaluated by computing set difference: Newcomers(y) = Users(y) \\ ⋃_{i < y} Users(i).',
        'Bots, automated upload wizards, and administrative maintenance accounts are strictly excluded via heuristic filtering.',
        'Requires chronological continuity across consecutive national campaign editions.'
      ],
      caveats: [
        'First observed year in the time range serves as the historical baseline; all participants in the initial year are classified as baseline cohort.',
        'Account renames or unified login (SUL) adjustments across projects may influence historical identification.'
      ]
    };
  } else if (module === 'retention') {
    meta = {
      indicator_id: 'retention_yoy',
      title: 'Year-over-Year Contributor Retention Rate',
      definition: 'Proportion of contributors from year y-1 who returned to upload at least one image in year y.',
      data_source: 'Wikimedia Commons Category Members API & Toolforge Database',
      metric_unit: '%',
      coverage: 'Annual national campaign editions (2010–present)',
      license: 'CC BY-SA 4.0',
      methodology_notes: [
        'Retention rate = (|U_y ∩ U_{y-1}| / |U_{y-1}|) × 100% where U_y represents the set of verified uploaders in year y.',
        'Directional forward tracking measures the exact repeat-participation quotient between consecutive annual cycles.',
        'Accounts with known bot or batch uploader signatures are scrubbed prior to set intersection.'
      ],
      caveats: [
        'Gaps between skipped editions (e.g., pandemic hiatuses or organizer hiatus) are treated as non-consecutive.',
        'Retention metrics represent upload activity specifically within the designated national campaign category.'
      ]
    };
  } else if (module === 'quality') {
    const isRate = params.metricKey === 'quality_rate_pct' || params.metricKey === 'quality_rate';
    meta = {
      indicator_id: isRate ? 'quality_rate' : 'quality_honors',
      title: isRate ? 'Quality Recognition Rate' : 'Quality-Recognized Contributions',
      definition: isRate
        ? 'Percentage of campaign media uploads designated as Quality Images, Featured Pictures, or Valued Images.'
        : 'Total count of campaign media uploads designated as Quality Images (QI), Featured Pictures (FP), or Valued Images (VI) on Wikimedia Commons.',
      data_source: 'Wikimedia Commons Assessment Categories & Picture of the Year Archives',
      metric_unit: isRate ? '%' : 'Recognized Works',
      coverage: 'Annual national campaign editions (2010–present)',
      license: 'CC BY-SA 4.0',
      methodology_notes: [
        'Recognized media aggregates peer-reviewed distinctions: Featured Pictures (FP), Quality Images (QI), and Valued Images (VI).',
        'Honors are tracked per media file and attributed back to the national campaign edition of original upload.',
        'Quality rate expresses the proportion of recognized images relative to total campaign submissions.'
      ],
      caveats: [
        'Commons quality nominations occur post-campaign through open community peer review, introducing natural evaluation lag for recent editions.',
        'Certain national campaigns have higher community participation in Commons nomination processes.'
      ]
    };
  } else if (module === 'diversity') {
    const isTop10 = params.metricKey === 'top_10_percent_share' || params.metricKey === 'top10_share';
    meta = {
      indicator_id: isTop10 ? 'diversity_top10' : 'diversity_gini',
      title: isTop10 ? 'Pareto Top-Decile Upload Share' : 'Contributor Upload Gini Coefficient',
      definition: isTop10
        ? 'Percentage of aggregate campaign media submissions contributed by the top 10% most prolific uploaders.'
        : 'Statistical measure of inequality in media contribution volume across active campaign participants (0 = equal, 1 = monopoly).',
      data_source: 'Wikimedia Commons Category Members API & Toolforge Database',
      metric_unit: isTop10 ? '%' : 'Gini [0–1]',
      coverage: 'Annual national campaign editions (2010–present)',
      license: 'CC BY-SA 4.0',
      methodology_notes: [
        'Gini coefficient is calculated over sorted individual contributor upload frequencies: G = (2 ∑ i x_i) / (n ∑ x_i) - (n + 1)/n.',
        'Top 10% share measures Pareto concentration among the most active decile of uploaders.',
        'Automated upload bots and maintenance tools are excluded prior to distribution analysis.'
      ],
      caveats: [
        'High upload concentration is common in peer-production projects following power-law distributions.',
        'Contests with institutional mass uploads or GLAM partnerships show elevated top-decile concentration.'
      ]
    };
  } else {
    // utility
    const isRate =
      params.metricKey === 'utility_rate' ||
      params.metricKey === 'utility_rate_pct' ||
      params.metricKey === 'global_utility_rate' ||
      params.metricKey === 'global_utility_rate_pct';
    meta = {
      indicator_id: isRate ? 'utility_rate' : 'utility_global_usages',
      title: isRate ? 'Global Content Utility Rate' : 'Global Article Transclusion & Content Usages',
      definition: isRate
        ? 'Percentage of uploaded campaign media actively illustrating at least one article on Wikipedia or sister projects.'
        : 'Total number of live transclusions and article illustrations across global Wikipedia language editions and sister projects.',
      data_source: 'Wikimedia Commons GlobalUsage API & Content Translation Databases',
      metric_unit: isRate ? '%' : 'Article Usages',
      coverage: 'Annual national campaign editions (2010–present)',
      license: 'CC BY-SA 4.0',
      methodology_notes: [
        'Measures global cross-wiki transclusions across Wikipedia, Wikivoyage, Wiktionary, and sister Wikimedia platforms.',
        'Global utility rate reflects the percentage of uploaded media actively illustrating at least one encyclopedic article.',
        'Distinct article counts deduplicate multiple appearances within the same encyclopedic entry.'
      ],
      caveats: [
        'Article transclusion metrics grow over time as volunteer editors discover and incorporate campaign media into encyclopedic entries.',
        'Language edition coverage correlates with topic relevance to regional and international wiki communities.'
      ]
    };
  }

  const eventName = EVENT_MAP[eventType] || (eventType ? eventType.toUpperCase() : 'Campaigns');

  return {
    module,
    indicator_id: meta.indicator_id,
    indicator_title: meta.title,
    indicator_unit: meta.metric_unit,
    event_type: eventType,
    event_name: eventName,
    years,
    selected_countries: requestedCountries,
    series,
    table_data: {
      headers,
      rows: tableRows
    },
    map_timeline_data: mapTimelineData,
    metadata_card: meta
  };
}

export function createComparativeMultiLineSvg(
  result: ComparativeAnalyticsResult,
  options: { width?: number; height?: number } = {}
): string {
  const width = options.width || 820;
  const height = options.height || 420;
  const margin = { top: 40, right: 130, bottom: 45, left: 65 };

  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;

  // Gather all valid numeric values
  const allValues: number[] = [];
  for (const s of result.series) {
    for (const pt of s.points) {
      if (pt.value !== null && !isNaN(pt.value)) {
        allValues.push(pt.value);
      }
    }
  }

  const maxVal = allValues.length > 0 ? Math.max(...allValues, 10) : 100;
  const yMax = Math.ceil(maxVal * 1.15);
  const years = result.years;
  const numYears = years.length;

  function getX(yr: number): number {
    if (numYears <= 1) return margin.left + plotW / 2;
    const idx = years.indexOf(yr);
    return margin.left + (idx / (numYears - 1)) * plotW;
  }

  function getY(val: number): number {
    return margin.top + plotH - (val / yMax) * plotH;
  }

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="background:#ffffff; font-family:'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">`;

  // Title
  svg += `<text x="${margin.left}" y="22" font-size="14" font-weight="700" fill="#202122">${result.indicator_title} · ${result.event_name}</text>`;
  svg += `<text x="${width - margin.right + 10}" y="22" text-anchor="start" font-size="11" font-weight="500" fill="#72777d">${result.indicator_unit}</text>`;

  // Horizontal Grid Lines & Y Ticks (5 steps)
  const steps = 5;
  for (let i = 0; i <= steps; i++) {
    const val = (yMax / steps) * i;
    const y = getY(val);
    svg += `<line x1="${margin.left}" y1="${y}" x2="${margin.left + plotW}" y2="${y}" stroke="#eaecf0" stroke-width="1" />`;
    const fTick = val >= 1000 ? `${(val / 1000).toFixed(1)}k` : val.toFixed(result.indicator_unit === '%' ? 1 : 0);
    svg += `<text x="${margin.left - 8}" y="${y + 4}" text-anchor="end" font-size="10" fill="#72777d">${fTick}${result.indicator_unit === '%' ? '%' : ''}</text>`;
  }

  // X Axis Line & Year Labels
  svg += `<line x1="${margin.left}" y1="${margin.top + plotH}" x2="${margin.left + plotW}" y2="${margin.top + plotH}" stroke="#a2a9b1" stroke-width="1.5" />`;
  for (const yr of years) {
    const x = getX(yr);
    svg += `<line x1="${x}" y1="${margin.top + plotH}" x2="${x}" y2="${margin.top + plotH + 5}" stroke="#72777d" stroke-width="1" />`;
    svg += `<text x="${x}" y="${margin.top + plotH + 20}" text-anchor="middle" font-size="11" font-weight="600" fill="#202122">${yr}</text>`;
  }

  // Draw Lines & Data Points for Each Series
  for (const s of result.series) {
    const validPts = s.points.filter((p) => p.value !== null && !isNaN(p.value!));
    if (validPts.length === 0) continue;

    // Line path
    const pathD = validPts.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${getX(pt.year)} ${getY(pt.value!)}`).join(' ');
    svg += `<path d="${pathD}" fill="none" stroke="${s.color}" stroke-width="2.5" stroke-linejoin="miter" stroke-linecap="square" />`;

    // Data points: square markers (rx="0" ry="0")
    for (const pt of validPts) {
      const cx = getX(pt.year);
      const cy = getY(pt.value!);
      svg += `<rect x="${cx - 4}" y="${cy - 4}" width="8" height="8" rx="0" ry="0" fill="${s.color}" stroke="#ffffff" stroke-width="1.5" />`;
    }

    // Direct Line End Label at final point
    const lastPt = validPts[validPts.length - 1];
    const lx = getX(lastPt.year);
    const ly = getY(lastPt.value!);
    svg += `<rect x="${lx + 8}" y="${ly - 4}" width="8" height="8" rx="0" ry="0" fill="${s.color}" />`;
    svg += `<text x="${lx + 20}" y="${ly + 3}" font-size="11" font-weight="600" fill="#202122">${s.country_name}</text>`;
  }

  svg += `</svg>`;
  return svg;
}

// =========================================================================
// MODULE 04 & 05: MOBILITY & DIVERSITY ANALYTICS
// =========================================================================

export async function computeSingleDiversityRecord(
  eventType: string,
  countryCode: string,
  year: number
): Promise<DiversityRecord> {
  const yr = String(year % 100).padStart(2, '0');
  const scope = EVENT_COUNTRY_SCOPE[eventType] || '*';
  const isCountryless = typeof scope === 'object' && scope.no_country_suffix;
  const code = countryCode === 'all' || isCountryless ? `${eventType}${yr}` : `${eventType}${countryCode}${yr}`;
  const countryName = countryDisplayName(countryCode);

  const countsMap = await getParticipantsWithUploadCounts(code);
  const n = countsMap.size;

  if (n === 0) {
    return {
      year,
      code,
      country_code: countryCode,
      country_name: countryName,
      total_users: 0,
      total_uploads: 0,
      gini_coefficient: 0,
      top_10_percent_share: 0,
      top_20_percent_share: 0,
      tiers: {
        casual_count: 0,
        casual_share: 0,
        regular_count: 0,
        regular_share: 0,
        active_count: 0,
        active_share: 0,
        power_count: 0,
        power_share: 0
      },
      percentile_shares: new Array(101).fill(0),
      lorenz_curve: [{ p: 0, l: 0 }, { p: 100, l: 0 }]
    };
  }

  const x = Array.from(countsMap.values()).sort((a, b) => a - b);
  const totalUploads = x.reduce((a, b) => a + b, 0);

  if (n === 1 || totalUploads === 0) {
    const singleVal = x[0] || 0;
    const singleShares = new Array(101).fill(100);
    singleShares[0] = 0;
    return {
      year,
      code,
      country_code: countryCode,
      country_name: countryName,
      total_users: n,
      total_uploads: totalUploads,
      gini_coefficient: 0,
      top_10_percent_share: 100,
      top_20_percent_share: 100,
      tiers: {
        casual_count: singleVal < 5 ? 1 : 0,
        casual_share: singleVal < 5 ? 100 : 0,
        regular_count: singleVal >= 5 && singleVal < 25 ? 1 : 0,
        regular_share: singleVal >= 5 && singleVal < 25 ? 100 : 0,
        active_count: singleVal >= 25 && singleVal < 100 ? 1 : 0,
        active_share: singleVal >= 25 && singleVal < 100 ? 100 : 0,
        power_count: singleVal >= 100 ? 1 : 0,
        power_share: singleVal >= 100 ? 100 : 0
      },
      percentile_shares: singleShares,
      lorenz_curve: [{ p: 0, l: 0 }, { p: 100, l: 100 }]
    };
  }

  // Discrete Gini Coefficient:
  // G = (2 * sum_{i=1}^n i * x_i) / (n * sum x_i) - (n + 1) / n
  let sumIndexed = 0;
  for (let i = 0; i < n; i++) {
    sumIndexed += (i + 1) * x[i];
  }
  const rawGini = (2 * sumIndexed) / (n * totalUploads) - (n + 1) / n;
  const gini = parseFloat(Math.max(0, Math.min(1, rawGini)).toFixed(3));

  // Top 10% and Top 20% Pareto Shares
  const k10 = Math.max(1, Math.round(n * 0.10));
  const top10Sum = x.slice(n - k10).reduce((a, b) => a + b, 0);
  const top10Share = parseFloat(((top10Sum / totalUploads) * 100).toFixed(1));

  const k20 = Math.max(1, Math.round(n * 0.20));
  const top20Sum = x.slice(n - k20).reduce((a, b) => a + b, 0);
  const top20Share = parseFloat(((top20Sum / totalUploads) * 100).toFixed(1));

  // Compute full 0-100 percentile upload share lookup array
  const percentileShares: number[] = new Array(101).fill(0);
  percentileShares[100] = 100;
  for (let p = 1; p < 100; p++) {
    const k = Math.max(1, Math.round(n * (p / 100)));
    const topKSum = x.slice(n - k).reduce((a, b) => a + b, 0);
    percentileShares[p] = parseFloat(((topKSum / totalUploads) * 100).toFixed(1));
  }

  // Compute Lorenz curve points (cumulative % users vs cumulative % uploads)
  const lorenzCurve: { p: number; l: number }[] = [];
  let cumUploads = 0;
  lorenzCurve.push({ p: 0, l: 0 });
  const sampleStep = Math.max(1, Math.floor(n / 25));
  for (let i = 0; i < n; i++) {
    cumUploads += x[i];
    if (i === n - 1 || (i + 1) % sampleStep === 0) {
      lorenzCurve.push({
        p: parseFloat((((i + 1) / n) * 100).toFixed(1)),
        l: parseFloat(((cumUploads / totalUploads) * 100).toFixed(1))
      });
    }
  }

  // 4-Tier Breakdown
  let casualCount = 0;
  let regularCount = 0;
  let activeCount = 0;
  let powerCount = 0;

  for (const count of x) {
    if (count < 5) casualCount++;
    else if (count < 25) regularCount++;
    else if (count < 100) activeCount++;
    else powerCount++;
  }

  const tiers: ContributorTierBreakdown = {
    casual_count: casualCount,
    casual_share: parseFloat(((casualCount / n) * 100).toFixed(1)),
    regular_count: regularCount,
    regular_share: parseFloat(((regularCount / n) * 100).toFixed(1)),
    active_count: activeCount,
    active_share: parseFloat(((activeCount / n) * 100).toFixed(1)),
    power_count: powerCount,
    power_share: parseFloat(((powerCount / n) * 100).toFixed(1))
  };

  return {
    year,
    code,
    country_code: countryCode,
    country_name: countryName,
    total_users: n,
    total_uploads: totalUploads,
    gini_coefficient: gini,
    top_10_percent_share: top10Share,
    top_20_percent_share: top20Share,
    tiers,
    percentile_shares: percentileShares,
    lorenz_curve: lorenzCurve
  };
}

export async function computeDiversityAnalytics(params: {
  eventType: string;
  countryCode: string;
  startYear?: number;
  endYear?: number;
}): Promise<DiversityResult> {
  const currentYear = new Date().getFullYear();
  const currentY = currentYear - 1;
  const startYear = Math.max(2010, Math.min(params.startYear || currentY - 4, params.endYear || currentY));
  const endYear = Math.min(2040, Math.max(params.endYear || currentY, startYear));
  const eventType = (params.eventType || 'wlm').trim().toLowerCase();
  const cc = (params.countryCode || 'de').trim().toLowerCase();
  const countryName = countryDisplayName(cc);
  const eventName = EVENT_MAP[eventType] ? `Wiki Loves ${EVENT_MAP[eventType]}` : eventType.toUpperCase();

  const records: DiversityRecord[] = [];
  for (let y = startYear; y <= endYear; y++) {
    const rec = await computeSingleDiversityRecord(eventType, cc, y);
    records.push(rec);
  }

  const validGinis = records.filter((r) => r.total_users > 0).map((r) => r.gini_coefficient);
  const validTop10 = records.filter((r) => r.total_users > 0).map((r) => r.top_10_percent_share);

  const avgGini = validGinis.length > 0
    ? parseFloat((validGinis.reduce((a, b) => a + b, 0) / validGinis.length).toFixed(3))
    : 0;
  const latestGini = validGinis.length > 0 ? validGinis[validGinis.length - 1] : 0;

  const avgTop10 = validTop10.length > 0
    ? parseFloat((validTop10.reduce((a, b) => a + b, 0) / validTop10.length).toFixed(1))
    : 0;
  const latestTop10 = validTop10.length > 0 ? validTop10[validTop10.length - 1] : 0;

  return {
    event_type: eventType,
    event_name: eventName,
    country_code: cc,
    country_name: countryName,
    start_year: startYear,
    end_year: endYear,
    records,
    summary: {
      average_gini: avgGini,
      latest_gini: latestGini,
      average_top_10_share: avgTop10,
      latest_top_10_share: latestTop10
    },
    metadata_card: {
      indicator_id: 'diversity_gini',
      title: 'Contributor Diversity & Upload Concentration',
      definition: 'Distribution of media contributions across active campaign participants, measured via the Gini coefficient and Pareto top-decile upload concentration.',
      data_source: 'Wikimedia Commons Category Members API & Toolforge Database',
      metric_unit: 'Gini [0–1] & %',
      coverage: 'Annual national campaign editions (2010–present)',
      license: 'CC BY-SA 4.0',
      methodology_notes: [
        'Gini coefficient is calculated from ascendingly ordered contributor submissions.',
        'Pareto top-decile share measures the percentage of total submissions generated by the top 10% most prolific uploaders.',
        'Four-tier contributor segmentation categorizes users into Casual (1–4), Regular (5–24), Active (25–99), and Power (100+) contributors.',
        'Known bots and batch administrative tools are excluded to prevent artificial concentration skew.'
      ],
      caveats: [
        'High upload concentration is common in peer-production projects following power-law distributions (Zipf law).',
        'Contests with mass upload workshops or institutional GLAM partnerships may show higher power-uploader concentration.'
      ]
    }
  };
}

export async function computeMobilityAnalytics(params: {
  year: number;
  countryCode: string;
  events?: string[];
}): Promise<MobilityResult> {
  const currentYear = new Date().getFullYear();
  const year = params.year || currentYear - 1;
  const cc = (params.countryCode || '').trim().toLowerCase() || 'de';
  const countryName = countryDisplayName(cc);
  const yr = String(year % 100).padStart(2, '0');

  // Candidate events
  const defaultEvents = ['wlm', 'wle', 'wlf', 'wla', 'wlb'];
  const requestedEvents = params.events && params.events.length > 0 ? params.events : defaultEvents;

  // Filter events scoped for this country
  const validEvents: string[] = [];
  for (const e of requestedEvents) {
    if (isEventScopedForCountry(e, cc)) {
      validEvents.push(e);
    }
  }

  // Ensure at least 2 events exist to compare
  const eventsToUse = validEvents.length >= 2 ? validEvents : ['wlm', 'wle', 'wlf'];

  // Map codes
  const eventCodes: Record<string, string> = {};
  const codeList: string[] = [];
  for (const e of eventsToUse) {
    const scope = EVENT_COUNTRY_SCOPE[e] || '*';
    const isCountryless = typeof scope === 'object' && scope.no_country_suffix;
    const code = cc === 'all' || isCountryless ? `${e}${yr}` : `${e}${cc}${yr}`;
    eventCodes[e] = code;
    codeList.push(code);
  }

  const cohorts = await fetchAllConcurrently(codeList);

  const eventUserCounts: Record<string, number> = {};
  const eventNames: Record<string, string> = {};
  const allUsersUnion = new Set<string>();

  for (const e of eventsToUse) {
    const code = eventCodes[e];
    const userSet = cohorts[code.toLowerCase()] || new Set<string>();
    eventUserCounts[e] = userSet.size;
    eventNames[e] = EVENT_MAP[e] ? `Wiki Loves ${EVENT_MAP[e]}` : e.toUpperCase();
    for (const u of userSet) {
      allUsersUnion.add(u);
    }
  }

  // Build N x N directional conversion matrix
  const matrix: MobilityMatrixRow[] = [];
  let maxConversion: { source: string; target: string; rate: number } | null = null;
  let maxOverlap: { source: string; target: string; count: number } | null = null;
  let sumConversion = 0;
  let offDiagonalCount = 0;

  for (const src of eventsToUse) {
    const srcCode = eventCodes[src];
    const srcUsers = cohorts[srcCode.toLowerCase()] || new Set<string>();
    const cells: MobilityMatrixCell[] = [];

    for (const tgt of eventsToUse) {
      const tgtCode = eventCodes[tgt];
      const tgtUsers = cohorts[tgtCode.toLowerCase()] || new Set<string>();

      let overlapCount = 0;
      for (const u of srcUsers) {
        if (tgtUsers.has(u)) overlapCount++;
      }

      const conversionRate = srcUsers.size > 0
        ? parseFloat(((overlapCount / srcUsers.size) * 100).toFixed(1))
        : 0;

      const unionSize = new Set([...srcUsers, ...tgtUsers]).size;
      const jaccard = unionSize > 0
        ? parseFloat(((overlapCount / unionSize) * 100).toFixed(1))
        : 0;

      if (src !== tgt && srcUsers.size > 0) {
        sumConversion += conversionRate;
        offDiagonalCount++;

        if (!maxConversion || conversionRate > maxConversion.rate) {
          maxConversion = { source: eventNames[src], target: eventNames[tgt], rate: conversionRate };
        }
        if (!maxOverlap || overlapCount > maxOverlap.count) {
          maxOverlap = { source: eventNames[src], target: eventNames[tgt], count: overlapCount };
        }
      }

      cells.push({
        source_event: src,
        source_name: eventNames[src],
        target_event: tgt,
        target_name: eventNames[tgt],
        source_users_count: srcUsers.size,
        target_users_count: tgtUsers.size,
        overlap_count: overlapCount,
        conversion_rate: conversionRate,
        jaccard_similarity: jaccard
      });
    }

    matrix.push({
      source_event: src,
      source_name: eventNames[src],
      source_users_count: srcUsers.size,
      cells
    });
  }

  const avgConversion = offDiagonalCount > 0
    ? parseFloat((sumConversion / offDiagonalCount).toFixed(1))
    : 0;

  const flow = computeEcosystemFlow(eventsToUse, eventNames, cohorts, eventCodes);

  return {
    year,
    country_code: cc,
    country_name: countryName,
    events: eventsToUse,
    event_names: eventNames,
    event_user_counts: eventUserCounts,
    total_unique_ecosystem_users: allUsersUnion.size,
    matrix,
    summary: {
      highest_conversion: maxConversion,
      highest_overlap: maxOverlap,
      average_conversion: avgConversion
    },
    flow,
    metadata_card: {
      indicator_id: 'mobility_overlap',
      title: 'Cross-Campaign Contributor Mobility & Community Overlap',
      definition: 'Proportion of contributors from a source photography campaign who also participated in a target campaign within the same national or regional ecosystem.',
      data_source: 'Wikimedia Commons Category Members API & Toolforge Database',
      metric_unit: '%',
      coverage: 'Annual national campaign editions (2010–present)',
      license: 'CC BY-SA 4.0',
      methodology_notes: [
        'Directional conversion rate measures participant fluidity from campaign A to campaign B as a percentage of source participants.',
        'Jaccard community similarity measures symmetrical community overlap relative to the combined participant pool.',
        'Ecosystem total reflects deduplicated unique photographers active across any of the evaluated campaign formats in the specified year.',
        'Automated upload bots, administrative accounts, and upload tools are filtered out prior to set intersection.'
      ],
      caveats: [
        'Regional scope constraints apply (e.g. Wiki Loves Africa operates exclusively in African nations; Wiki Loves Bangla operates in Bangladesh and India).',
        'Campaigns occurring in different calendar months within the same year reflect sequential onboarding rather than simultaneous participation.'
      ]
    }
  };
}

export function computeEcosystemFlow(
  events: string[],
  eventNames: Record<string, string>,
  cohorts: Record<string, Set<string>>,
  eventCodes: Record<string, string>
): EcosystemFlowData {
  const nodes: SankeyNode[] = [];
  const links: SankeyLink[] = [];
  const nodeIndexMap = new Map<string, number>();

  function getOrAddNode(name: string, color: string): number {
    if (nodeIndexMap.has(name)) {
      return nodeIndexMap.get(name)!;
    }
    const idx = nodes.length;
    nodes.push({ name, color });
    nodeIndexMap.set(name, idx);
    return idx;
  }

  // 1. Create Source Nodes (one for each campaign)
  const sourceNodeIndices: number[] = [];
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const code = eventCodes[e];
    const users = cohorts[code.toLowerCase()] || new Set<string>();
    const color = CODEX_COLOR_PALETTE[i % CODEX_COLOR_PALETTE.length];
    const label = `${eventNames[e]} (${users.size.toLocaleString()})`;
    const sIdx = getOrAddNode(label, color);
    sourceNodeIndices.push(sIdx);
  }

  // 2. Classify each user by exact subset of campaigns they participated in
  const userSubsetCounts = new Map<string, number>();
  const allUsers = new Set<string>();
  for (const e of events) {
    const code = eventCodes[e];
    const set = cohorts[code.toLowerCase()] || new Set<string>();
    for (const u of set) allUsers.add(u);
  }

  for (const u of allUsers) {
    const activeIndices: number[] = [];
    for (let i = 0; i < events.length; i++) {
      const code = eventCodes[events[i]];
      const set = cohorts[code.toLowerCase()] || new Set<string>();
      if (set.has(u)) activeIndices.push(i);
    }
    const key = activeIndices.join(',');
    userSubsetCounts.set(key, (userSubsetCounts.get(key) || 0) + 1);
  }

  // 3. Build target nodes & links for each subset
  for (const [key, count] of userSubsetCounts.entries()) {
    if (!key || count <= 0) continue;
    const indices = key.split(',').map((x) => parseInt(x, 10));

    if (indices.length === 1) {
      // Single campaign exclusive
      const srcIdx = indices[0];
      const e = events[srcIdx];
      const targetLabel = `${eventNames[e]} Exclusive (${count.toLocaleString()})`;
      const targetColor = '#54595d'; // Muted slate for exclusive
      const tNodeIdx = getOrAddNode(targetLabel, targetColor);
      links.push({
        source: sourceNodeIndices[srcIdx],
        target: tNodeIdx,
        value: count,
        label: `${count.toLocaleString()} participants active exclusively in ${eventNames[e]}`
      });
    } else {
      // Multi-campaign shared subset
      const sharedNames = indices.map((idx) => eventNames[events[idx]].replace('Wiki Loves ', '')).join(' + ');
      const targetLabel = indices.length === events.length
        ? `All ${events.length} Campaigns (${count.toLocaleString()})`
        : `Shared: ${sharedNames} (${count.toLocaleString()})`;
      const targetColor = '#008080'; // Deep Teal for cross-campaign bridge
      const tNodeIdx = getOrAddNode(targetLabel, targetColor);

      for (const srcIdx of indices) {
        links.push({
          source: sourceNodeIndices[srcIdx],
          target: tNodeIdx,
          value: count,
          label: `${count.toLocaleString()} participants shared with ${targetLabel}`
        });
      }
    }
  }

  return { nodes, links };
}

