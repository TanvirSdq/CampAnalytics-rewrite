/**
 * CampTools Automated Daily Raw-Data Sync & Materialization Worker
 *
 * Designed for Wikimedia Toolforge (`toolforge jobs load jobs.yaml`).
 * Supports two execution engines:
 *   1. Wiki Replica MariaDB SQL (`commonswiki.analytics.db.svc.wikimedia.cloud`)
 *      via `/data/project/camptools/replica.my.cnf` + optional ToolsDB persistence.
 *   2. Concurrent Wikimedia Commons Action API & PTools harvesting fallback.
 *
 * Writes an atomic materialized snapshot (`camptools_daily_snapshot.json`) to
 * `$TOOL_DATA_DIR/data/` so the stateless webservice serves requests in <15ms.
 */

import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

import {
  EVENT_MAP,
  COUNTRY_MAP,
  getCategoryCandidates,
  getQualityCategoryCandidates,
  getFeaturedCategoryCandidates,
  isEventScopedForCountry,
  isBotAccount,
  normalizeMediaWikiUsername,
  getParticipantsWithUploadCounts,
  getCampaignStructuralMetrics,
  computeContentUtilityDeep,
  computeQualityRecognitionDeep
} from '../core/analytics.js';

import {
  loadDailySnapshot,
  saveDailySnapshot,
  getSnapshotFilePath,
  CampaignSnapshotRecord,
  DailySnapshotStoreData
} from '../core/snapshotStore.js';

import { mapConcurrent } from '../core/utils.js';

const execFileAsync = promisify(execFile);

const REPLICA_CNF_CANDIDATES = [
  process.env.REPLICA_MY_CNF || '',
  process.env.TOOL_DATA_DIR ? path.join(process.env.TOOL_DATA_DIR, 'replica.my.cnf') : '',
  '/data/project/camptools/replica.my.cnf',
  path.join(process.env.HOME || '', 'replica.my.cnf')
].filter(Boolean);

function findReplicaCnf(): string | null {
  for (const p of REPLICA_CNF_CANDIDATES) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      // Ignore permission errors
    }
  }
  return null;
}

async function findMysqlBinary(): Promise<string | null> {
  const candidates = [
    process.env.MYSQL_BIN || '',
    'mysql',
    '/usr/bin/mysql',
    '/usr/local/bin/mysql',
    '/layers/heroku_deb-packages/packages/usr/bin/mysql',
    '/layers/heroku_deb-packages/packages/usr/bin/mariadb'
  ].filter(Boolean);

  for (const bin of candidates) {
    try {
      await execFileAsync(bin, ['--version']);
      return bin;
    } catch {
      // Ignore not found
    }
  }
  return null;
}

/**
 * Executes a read-only SQL query against `commonswiki_p` on Wikimedia Wiki Replicas
 * using the standard Toolforge `mysql` client and `replica.my.cnf`.
 * Strictly adheres to Wikimedia DBA rules: queries indexed `cl_to`, `page_id`, `img_name`, `actor_id`.
 */
async function queryCommonsReplicaTsv(mysqlBin: string, cnfPath: string, sql: string): Promise<string[][]> {
  const host = process.env.WIKI_REPLICA_HOST || 'commonswiki.analytics.db.svc.wikimedia.cloud';
  const db = process.env.WIKI_REPLICA_DB || 'commonswiki_p';

  const { stdout } = await execFileAsync(
    mysqlBin,
    [
      `--defaults-file=${cnfPath}`,
      '-h',
      host,
      '-D',
      db,
      '--batch',
      '--raw',
      '--skip-column-names',
      '-e',
      sql
    ],
    { timeout: 60000, maxBuffer: 32 * 1024 * 1024 }
  );

  if (!stdout || !stdout.trim()) return [];
  return stdout
    .trim()
    .split('\n')
    .map((line) => line.split('\t'));
}

function escapeSqlLiteral(val: string): string {
  return val.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * Harvests uploader counts and structural metrics for a single campaign code
 * directly from `commonswiki_p` using indexed `categorylinks` (`cl_to`) joins.
 */
async function harvestCampaignViaReplicaSql(
  mysqlBin: string,
  cnfPath: string,
  code: string
): Promise<{
  userCounts: Record<string, number>;
  totalUploads: number;
  usedFilesCount: number;
  qualityCount: number;
  featuredCount: number;
} | null> {
  const categories = getCategoryCandidates(code);
  if (categories.length === 0) return null;

  let activeCat = '';
  const userCounts: Record<string, number> = {};
  let totalUploads = 0;

  for (const cat of categories) {
    const dbCat = escapeSqlLiteral(cat.replace(/\s+/g, '_'));
    // DBA-compliant indexed query: categorylinks(cl_to) -> page(page_id) -> image(img_name) -> actor_image(actor_id)
    const sql = `
      SELECT a.actor_name, COUNT(*) AS upload_count
      FROM categorylinks cl
      INNER JOIN page p ON p.page_id = cl.cl_from AND p.page_namespace = 6
      INNER JOIN image img ON img.img_name = p.page_title
      INNER JOIN actor_image a ON a.actor_id = img.img_actor
      WHERE cl.cl_to = '${dbCat}' AND cl.cl_type = 'file'
      GROUP BY a.actor_name;
    `;
    const rows = await queryCommonsReplicaTsv(mysqlBin, cnfPath, sql);
    if (rows.length > 0) {
      activeCat = dbCat;
      for (const [rawUser, cntStr] of rows) {
        const username = normalizeMediaWikiUsername(rawUser || '');
        const cnt = parseInt(cntStr || '0', 10);
        if (username && !isBotAccount(username) && cnt > 0) {
          userCounts[username] = (userCounts[username] || 0) + cnt;
          totalUploads += cnt;
        }
      }
      if (totalUploads > 0) break;
    }
  }

  if (!activeCat || totalUploads === 0) {
    return {
      userCounts: {},
      totalUploads: 0,
      usedFilesCount: 0,
      qualityCount: 0,
      featuredCount: 0
    };
  }

  // Indexed globalimagelinks join for distinct in-use files
  let usedFilesCount = 0;
  try {
    const usageSql = `
      SELECT COUNT(DISTINCT p.page_id)
      FROM categorylinks cl
      INNER JOIN page p ON p.page_id = cl.cl_from AND p.page_namespace = 6
      INNER JOIN globalimagelinks gil ON gil.gil_to = p.page_title
      WHERE cl.cl_to = '${activeCat}' AND cl.cl_type = 'file';
    `;
    const uRows = await queryCommonsReplicaTsv(mysqlBin, cnfPath, usageSql);
    if (uRows.length > 0 && uRows[0][0]) {
      usedFilesCount = parseInt(uRows[0][0], 10) || 0;
    }
  } catch {
    usedFilesCount = 0;
  }

  // Indexed Quality Images count
  let qualityCount = 0;
  const qiCats = getQualityCategoryCandidates(code);
  if (qiCats.length > 0) {
    const inList = qiCats.map((c) => `'${escapeSqlLiteral(c.replace(/\s+/g, '_'))}'`).join(',');
    try {
      const qiSql = `
        SELECT cl_to, COUNT(*) AS cnt
        FROM categorylinks
        WHERE cl_to IN (${inList}) AND cl_type = 'file'
        GROUP BY cl_to
        ORDER BY cnt DESC
        LIMIT 1;
      `;
      const qRows = await queryCommonsReplicaTsv(mysqlBin, cnfPath, qiSql);
      if (qRows.length > 0 && qRows[0][1]) {
        qualityCount = parseInt(qRows[0][1], 10) || 0;
      }
    } catch {
      qualityCount = 0;
    }
  }

  // Indexed Featured Pictures count
  let featuredCount = 0;
  const fpCats = getFeaturedCategoryCandidates(code);
  if (fpCats.length > 0) {
    const inList = fpCats.map((c) => `'${escapeSqlLiteral(c.replace(/\s+/g, '_'))}'`).join(',');
    try {
      const fpSql = `
        SELECT cl_to, COUNT(*) AS cnt
        FROM categorylinks
        WHERE cl_to IN (${inList}) AND cl_type = 'file'
        GROUP BY cl_to
        ORDER BY cnt DESC
        LIMIT 1;
      `;
      const fRows = await queryCommonsReplicaTsv(mysqlBin, cnfPath, fpSql);
      if (fRows.length > 0 && fRows[0][1]) {
        featuredCount = parseInt(fRows[0][1], 10) || 0;
      }
    } catch {
      featuredCount = 0;
    }
  }

  return {
    userCounts,
    totalUploads,
    usedFilesCount,
    qualityCount,
    featuredCount
  };
}

/**
 * Optional ToolsDB (`tools.db.svc.wikimedia.cloud`) schema & table synchronization.
 * Creates `<user>__camptools_p.campaign_editions` if `TOOLSDB_ENABLED=1` and `replica.my.cnf` is present.
 */
async function syncRecordToToolsDb(
  mysqlBin: string,
  cnfPath: string,
  dbName: string,
  rec: CampaignSnapshotRecord
): Promise<void> {
  const host = process.env.TOOLSDB_HOST || 'tools.db.svc.wikimedia.cloud';
  const metrics = rec.structural_metrics || {
    total_uploads: 0,
    quality_images_count: 0,
    used_images_sample_count: 0,
    quality_image_share: 0,
    usage_share: 0,
    top10_uploader_share: 0
  };
  const uploadersCount = Object.keys(rec.user_counts || {}).length;
  const codeSafe = escapeSqlLiteral(rec.code);

  const sql = `
    CREATE DATABASE IF NOT EXISTS \`${dbName}\`;
    USE \`${dbName}\`;
    CREATE TABLE IF NOT EXISTS campaign_editions (
      code VARCHAR(16) NOT NULL PRIMARY KEY,
      total_uploaders INT NOT NULL DEFAULT 0,
      total_uploads INT NOT NULL DEFAULT 0,
      quality_count INT NOT NULL DEFAULT 0,
      used_files_count INT NOT NULL DEFAULT 0,
      quality_share_pct DECIMAL(6,2) NOT NULL DEFAULT 0.00,
      usage_share_pct DECIMAL(6,2) NOT NULL DEFAULT 0.00,
      top10_share_pct DECIMAL(6,2) NOT NULL DEFAULT 0.00,
      user_counts_json LONGTEXT,
      updated_at DATETIME NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    REPLACE INTO campaign_editions
      (code, total_uploaders, total_uploads, quality_count, used_files_count, quality_share_pct, usage_share_pct, top10_share_pct, user_counts_json, updated_at)
    VALUES (
      '${codeSafe}',
      ${uploadersCount},
      ${metrics.total_uploads || 0},
      ${metrics.quality_images_count || 0},
      ${metrics.used_images_sample_count || 0},
      ${metrics.quality_image_share || 0},
      ${metrics.usage_share || 0},
      ${metrics.top10_uploader_share || 0},
      '${escapeSqlLiteral(JSON.stringify(rec.user_counts || {}))}',
      UTC_TIMESTAMP()
    );
  `;

  await execFileAsync(mysqlBin, [`--defaults-file=${cnfPath}`, '-h', host, '-e', sql], {
    timeout: 30000
  });
}

function resolveToolsDbName(cnfPath: string): string | null {
  if (process.env.CAMPTOOLS_TOOLSDB_NAME) {
    return process.env.CAMPTOOLS_TOOLSDB_NAME;
  }
  try {
    const cnfContent = fs.readFileSync(cnfPath, 'utf-8');
    const userMatch = /^\s*user\s*=\s*['"]?([a-zA-Z0-9_]+)['"]?/m.exec(cnfContent);
    if (userMatch && userMatch[1]) {
      return `${userMatch[1]}__camptools_p`;
    }
  } catch {
    // Ignore read error
  }
  return null;
}

async function runDailySync(): Promise<void> {
  const args = process.argv.slice(2);
  const fullRefresh = args.includes('--full');
  const deepRefresh = args.includes('--deep');
  const startYearArg = args.find((a) => a.startsWith('--start-year='));
  const endYearArg = args.find((a) => a.startsWith('--end-year='));
  const countriesArg = args.find((a) => a.startsWith('--countries='));
  const eventsArg = args.find((a) => a.startsWith('--events='));

  const currentYear = new Date().getFullYear();
  const startYear = startYearArg ? parseInt(startYearArg.split('=')[1], 10) : Math.max(2015, currentYear - 6);
  const endYear = endYearArg ? parseInt(endYearArg.split('=')[1], 10) : currentYear;

  const events = eventsArg
    ? eventsArg.split('=')[1].split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
    : Object.keys(EVENT_MAP);

  const countries = countriesArg
    ? countriesArg.split('=')[1].split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
    : Object.keys(COUNTRY_MAP);

  const existingSnapshot = loadDailySnapshot(true);
  const campaignsMap: Record<string, CampaignSnapshotRecord> = {
    ...(existingSnapshot?.campaigns || {})
  };

  const cnfPath = findReplicaCnf();
  const mysqlBin = await findMysqlBinary();
  const toolsDbName = cnfPath ? resolveToolsDbName(cnfPath) : null;
  const useReplicaSql = Boolean(cnfPath && mysqlBin) && !args.includes('--api-only');

  console.log(
    JSON.stringify({
      level: 'info',
      event: 'daily_sync_start',
      mode: useReplicaSql ? 'wiki_replica_sql' : 'commons_api',
      replica_cnf: cnfPath,
      mysql_binary: mysqlBin,
      toolsdb_schema: toolsDbName,
      years: `${startYear}-${endYear}`,
      events_count: events.length,
      countries_count: countries.length,
      snapshot_path: getSnapshotFilePath()
    })
  );

  const targetCodes: Array<{ code: string; year: number }> = [];
  for (const evt of events) {
    for (const cc of countries) {
      if (!isEventScopedForCountry(evt, cc)) continue;
      for (let yr = startYear; yr <= endYear; yr++) {
        const yy = String(yr % 100).padStart(2, '0');
        targetCodes.push({ code: `${evt}${cc}${yy}`, year: yr });
      }
    }
  }

  let updatedCount = 0;
  let skippedHistoricalCount = 0;
  const nowMs = Date.now();
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

  await mapConcurrent(targetCodes, useReplicaSql ? 4 : 6, async ({ code, year }) => {
    const existing = campaignsMap[code];
    if (!fullRefresh && existing && year < currentYear) {
      const updatedMs = Date.parse(existing.updated_at || '');
      if (!isNaN(updatedMs) && nowMs - updatedMs < sevenDaysMs) {
        skippedHistoricalCount++;
        return;
      }
    }

    let harvested = false;

    if (useReplicaSql && cnfPath && mysqlBin) {
      try {
        const sqlRes = await harvestCampaignViaReplicaSql(mysqlBin, cnfPath, code);
        if (sqlRes && sqlRes.totalUploads > 0) {
          const uploadValues = Object.values(sqlRes.userCounts).sort((a, b) => b - a);
          const uploaderCount = uploadValues.length;
          const top10K = Math.max(1, Math.ceil(uploaderCount * 0.1));
          const top10Uploads = uploadValues.slice(0, top10K).reduce((a, b) => a + b, 0);
          const top10Share =
            sqlRes.totalUploads > 0 && top10Uploads > 0
              ? parseFloat(((top10Uploads / sqlRes.totalUploads) * 100).toFixed(1))
              : 0;
          const qualityShare =
            sqlRes.totalUploads > 0
              ? parseFloat(((sqlRes.qualityCount / sqlRes.totalUploads) * 100).toFixed(1))
              : 0;
          const usageShare =
            sqlRes.totalUploads > 0
              ? parseFloat(((sqlRes.usedFilesCount / sqlRes.totalUploads) * 100).toFixed(1))
              : 0;

          const record: CampaignSnapshotRecord = {
            code,
            updated_at: new Date().toISOString(),
            user_counts: sqlRes.userCounts,
            structural_metrics: {
              quality_image_share: qualityShare,
              quality_images_count: sqlRes.qualityCount,
              top10_uploader_share: top10Share,
              usage_share: usageShare,
              total_uploads: sqlRes.totalUploads,
              used_images_sample_count: sqlRes.usedFilesCount,
              sampled_files_count: sqlRes.totalUploads
            }
          };
          campaignsMap[code] = record;
          updatedCount++;
          harvested = true;

          if (toolsDbName && sqlRes.totalUploads > 0) {
            try {
              await syncRecordToToolsDb(mysqlBin, cnfPath, toolsDbName, record);
            } catch {
              // Non-fatal if ToolsDB write is not enabled
            }
          }
        }
      } catch (err: any) {
        console.warn(
          JSON.stringify({
            level: 'warn',
            event: 'replica_sql_fallback',
            code,
            error: err?.message || String(err)
          })
        );
      }
    }

    if (!harvested) {
      try {
        const countsMap = await getParticipantsWithUploadCounts(code);
        const userCountsObj: Record<string, number> = {};
        for (const [u, cnt] of countsMap.entries()) {
          userCountsObj[u] = cnt;
        }
        const structural = await getCampaignStructuralMetrics(code);
        const record: CampaignSnapshotRecord = {
          code,
          updated_at: new Date().toISOString(),
          user_counts: userCountsObj,
          structural_metrics: structural
        };

        if (deepRefresh && structural.total_uploads > 0) {
          record.utility_deep = await computeContentUtilityDeep(code);
          record.quality_deep = await computeQualityRecognitionDeep(code);
        }

        campaignsMap[code] = record;
        updatedCount++;
      } catch (err: any) {
        console.error(
          JSON.stringify({
            level: 'warn',
            event: 'campaign_sync_error',
            code,
            error: err?.message || String(err)
          })
        );
      }
    }
  });

  const snapshotData: DailySnapshotStoreData = {
    version: '1.1.0',
    generated_at: new Date().toISOString(),
    source: useReplicaSql ? 'wiki_replica_sql' : 'commons_api',
    campaigns: campaignsMap
  };

  const savedPath = saveDailySnapshot(snapshotData);
  console.log(
    JSON.stringify({
      level: 'info',
      event: 'daily_sync_complete',
      updated_count: updatedCount,
      skipped_historical_count: skippedHistoricalCount,
      total_cached_campaigns: Object.keys(campaignsMap).length,
      saved_path: savedPath
    })
  );
}

runDailySync().catch((err) => {
  console.error(
    JSON.stringify({
      level: 'error',
      event: 'daily_sync_fatal',
      error: err?.message || String(err)
    })
  );
  process.exit(1);
});
