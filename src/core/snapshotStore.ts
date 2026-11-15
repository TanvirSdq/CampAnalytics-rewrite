import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../..');

export interface CampaignSnapshotRecord {
  code: string;
  updated_at: string;
  user_counts: Record<string, number>;
  upload_counts?: Record<string, number>;
  structural_metrics?: {
    quality_image_share: number;
    quality_images_count?: number;
    top10_uploader_share: number;
    usage_share: number;
    total_uploads: number;
    used_images_sample_count?: number;
    sampled_files_count?: number;
  };
  utility_deep?: any;
  quality_deep?: any;
  survival_stats?: {
    newcomers_evaluated: number;
    cohort_size?: number;
    survived_30d_count: number;
    survived_60d_count: number;
    survived_90d_count: number;
    survived_30d_pct: number;
    survived_60d_pct: number;
    survived_90d_pct: number;
    reverted_uploads_count?: number;
    net_surviving_uploads_count?: number;
    upload_survival_rate_pct?: number;
    net_survival_rate_pct?: number;
  };
}

export interface DailySnapshotStoreData {
  version: string;
  generated_at: string;
  source: 'wiki_replica_sql' | 'commons_api' | 'hybrid';
  campaigns: Record<string, CampaignSnapshotRecord>;
}

let _loadedSnapshot: DailySnapshotStoreData | null = null;
let _lastLoadedMtimeMs = 0;

/**
 * Resolves the path to the persistent daily materialized snapshot file.
 * On Wikimedia Toolforge (--mount=all), $TOOL_DATA_DIR points to /data/project/camptools.
 */
export function getSnapshotFilePath(): string {
  if (process.env.CAMPTOOLS_SNAPSHOT_PATH) {
    return process.env.CAMPTOOLS_SNAPSHOT_PATH;
  }
  const toolDataDir = process.env.TOOL_DATA_DIR || (fs.existsSync('/data/project/camptools') ? '/data/project/camptools' : '');
  if (toolDataDir) {
    return path.join(toolDataDir, 'data', 'camptools_daily_snapshot.json');
  }
  return path.join(PROJECT_ROOT, 'data', 'camptools_daily_snapshot.json');
}

/**
 * Reads and caches the daily materialized snapshot from disk if available,
 * automatically reloading when the underlying file's mtime changes.
 */
export function loadDailySnapshot(forceReload = false): DailySnapshotStoreData | null {
  if (process.env.NODE_ENV === 'test' && !process.env.CAMPTOOLS_SNAPSHOT_PATH) {
    return null;
  }
  const filePath = getSnapshotFilePath();
  try {
    if (!fs.existsSync(filePath)) return null;
    const stat = fs.statSync(filePath);
    if (!forceReload && _loadedSnapshot && stat.mtimeMs === _lastLoadedMtimeMs) {
      return _loadedSnapshot;
    }
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as DailySnapshotStoreData;
    if (parsed && typeof parsed.campaigns === 'object') {
      _loadedSnapshot = parsed;
      _lastLoadedMtimeMs = stat.mtimeMs;
      return _loadedSnapshot;
    }
  } catch {
    // Ignore malformed or mid-rotation snapshot reads
  }
  return _loadedSnapshot;
}

/**
 * Atomically writes the daily materialized snapshot to disk using a temporary file rename.
 */
export function saveDailySnapshot(data: DailySnapshotStoreData): string {
  const filePath = getSnapshotFilePath();
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmpPath, filePath);
  _loadedSnapshot = data;
  try {
    _lastLoadedMtimeMs = fs.statSync(filePath).mtimeMs;
  } catch {
    _lastLoadedMtimeMs = Date.now();
  }
  return filePath;
}

export function getSnapshotCampaignRecord(code: string): CampaignSnapshotRecord | null {
  if (process.env.CAMPTOOLS_BYPASS_SNAPSHOT === '1') return null;
  const snap = loadDailySnapshot();
  if (!snap || !snap.campaigns) return null;
  const clean = code.replace(/\s+/g, '').toLowerCase();
  if (snap.campaigns[clean]) {
    return snap.campaigns[clean];
  }

  // Composite 'all' campaign on-the-fly aggregation across subcampaigns in snapshot
  const match = /^(all)([a-z]{2,3})(\d{2})$/.exec(clean);
  if (match) {
    const [, , cc, yr] = match;
    const mergedCounts: Record<string, number> = {};
    let totalUploads = 0;
    let qualityCount = 0;
    let usedCount = 0;
    let foundAny = false;

    for (const evt of ['wlm', 'wle', 'wlf', 'wla', 'wlb']) {
      const subCode = `${evt}${cc}${yr}`;
      const subRec = snap.campaigns[subCode];
      if (subRec && (subRec.user_counts || subRec.upload_counts)) {
        foundAny = true;
        const counts = subRec.user_counts || subRec.upload_counts || {};
        for (const [u, cnt] of Object.entries(counts)) {
          mergedCounts[u] = (mergedCounts[u] || 0) + cnt;
        }
        if (subRec.structural_metrics) {
          totalUploads += subRec.structural_metrics.total_uploads || 0;
          qualityCount += subRec.structural_metrics.quality_images_count || 0;
          usedCount += subRec.structural_metrics.used_images_sample_count || 0;
        }
      }
    }

    if (foundAny) {
      const uploaders = Object.values(mergedCounts).sort((a, b) => b - a);
      const top10K = Math.max(1, Math.ceil(uploaders.length * 0.1));
      const top10Uploads = uploaders.slice(0, top10K).reduce((a, b) => a + b, 0);
      const top10Share = totalUploads > 0 && top10Uploads > 0 ? parseFloat(((top10Uploads / totalUploads) * 100).toFixed(1)) : 0;
      const qualityShare = totalUploads > 0 ? parseFloat(((qualityCount / totalUploads) * 100).toFixed(1)) : 0;
      const usageShare = totalUploads > 0 ? parseFloat(((usedCount / totalUploads) * 100).toFixed(1)) : 0;

      const compositeRecord: CampaignSnapshotRecord = {
        code: clean,
        updated_at: snap.generated_at,
        user_counts: mergedCounts,
        structural_metrics: {
          total_uploads: totalUploads,
          quality_images_count: qualityCount,
          used_images_sample_count: usedCount,
          quality_image_share: qualityShare,
          usage_share: usageShare,
          top10_uploader_share: top10Share
        }
      };
      // Memoize in snapshot cache
      snap.campaigns[clean] = compositeRecord;
      return compositeRecord;
    }
  }

  return null;
}

export function getSnapshotStatus(): {
  enabled: boolean;
  path: string;
  exists: boolean;
  generated_at: string | null;
  campaigns_count: number;
  source: string | null;
} {
  const filePath = getSnapshotFilePath();
  const exists = fs.existsSync(filePath);
  const snap = loadDailySnapshot();
  return {
    enabled: Boolean(snap),
    path: filePath,
    exists,
    generated_at: snap ? snap.generated_at : null,
    campaigns_count: snap && snap.campaigns ? Object.keys(snap.campaigns).length : 0,
    source: snap ? snap.source : null
  };
}
