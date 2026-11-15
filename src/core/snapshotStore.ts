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
  const snap = loadDailySnapshot();
  if (!snap || !snap.campaigns) return null;
  const clean = code.replace(/\s+/g, '').toLowerCase();
  return snap.campaigns[clean] || null;
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
