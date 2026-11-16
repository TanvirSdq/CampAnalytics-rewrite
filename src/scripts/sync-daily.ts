/**
 * CampTools Automated Daily Raw-Data Sync & Materialization Worker
 *
 * Designed for Wikimedia Toolforge (`toolforge jobs load jobs.yaml`).
 * Supports two execution engines:
 *   1. Wiki Replica MariaDB SQL (`commonswiki.analytics.db.svc.wikimedia.cloud`)
 *      via `/data/project/camptools/replica.my.cnf` using pure-Node TCP wire protocol
 *      (or `mysql` CLI if installed) + optional ToolsDB persistence.
 *   2. Concurrent Wikimedia Commons Action API & PTools harvesting fallback.
 *
 * Writes an atomic materialized snapshot (`camptools_daily_snapshot.json`) to
 * `$TOOL_DATA_DIR/data/` so the stateless webservice serves requests in <15ms.
 */

import {
  EVENT_MAP,
  COUNTRY_MAP,
  COUNTRY_TO_REGION,
  countryDisplayName,
  getCategoryCandidates,
  getQualityCategoryCandidates,
  getFeaturedCategoryCandidates,
  isEventScopedForCountry,
  isBotAccount,
  normalizeMediaWikiUsername,
  resolveCommonsThumbUrl,
  getParticipantsWithUploadCounts,
  getCampaignStructuralMetrics,
  computeContentUtilityDeep,
  computeQualityRecognitionDeep
} from '../core/analytics.js';

import {
  findReplicaCnf,
  loadReplicaCredentials,
  findMysqlBinary,
  resolveToolsDbName,
  escapeSqlLiteral,
  executeMariaDbQuery
} from '../core/replicaClient.js';

import {
  loadDailySnapshot,
  saveDailySnapshot,
  getSnapshotFilePath,
  CampaignSnapshotRecord,
  DailySnapshotStoreData
} from '../core/snapshotStore.js';

import { mapConcurrent } from '../core/utils.js';

async function queryCommonsReplica(
  cnfPath: string,
  mysqlBin: string | null,
  sql: string
): Promise<string[][]> {
  return executeMariaDbQuery({
    cnfPath,
    mysqlBin,
    sql,
    timeoutMs: 60000
  });
}

/**
 * Harvests uploader counts and structural metrics for a single campaign code
 * directly from `commonswiki_p` using indexed `categorylinks` (`cl_to`) joins.
 */
async function harvestCampaignViaReplicaSql(
  mysqlBin: string | null,
  cnfPath: string,
  code: string
): Promise<{
  activeCategory: string;
  userCounts: Record<string, number>;
  totalUploads: number;
  usedFilesCount: number;
  qualityCount: number;
  featuredCount: number;
  valuedCount: number;
  activeQiCat: string;
  activeFpCat: string;
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
    const rows = await queryCommonsReplica(cnfPath, mysqlBin, sql);
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
      activeCategory: '',
      userCounts: {},
      totalUploads: 0,
      usedFilesCount: 0,
      qualityCount: 0,
      featuredCount: 0,
      valuedCount: 0,
      activeQiCat: '',
      activeFpCat: ''
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
    const uRows = await queryCommonsReplica(cnfPath, mysqlBin, usageSql);
    if (uRows.length > 0 && uRows[0][0]) {
      usedFilesCount = parseInt(uRows[0][0], 10) || 0;
    }
  } catch {
    usedFilesCount = 0;
  }

  // Indexed Quality Images count
  let qualityCount = 0;
  let activeQiCat = '';
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
      const qRows = await queryCommonsReplica(cnfPath, mysqlBin, qiSql);
      if (qRows.length > 0 && qRows[0][1]) {
        activeQiCat = qRows[0][0] || '';
        qualityCount = parseInt(qRows[0][1], 10) || 0;
      }
    } catch {
      qualityCount = 0;
    }
  }

  // Indexed Featured Pictures count
  let featuredCount = 0;
  let activeFpCat = '';
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
      const fRows = await queryCommonsReplica(cnfPath, mysqlBin, fpSql);
      if (fRows.length > 0 && fRows[0][1]) {
        activeFpCat = fRows[0][0] || '';
        featuredCount = parseInt(fRows[0][1], 10) || 0;
      }
    } catch {
      featuredCount = 0;
    }
  }

  // Indexed Valued Images intersection against Category:Valued_images_sorted_by_promotion_date
  let valuedCount = 0;
  try {
    const viSql = `
      SELECT COUNT(DISTINCT cl1.cl_from)
      FROM categorylinks cl1
      INNER JOIN categorylinks cl2 ON cl1.cl_from = cl2.cl_from
      WHERE cl1.cl_to = '${activeCat}'
        AND cl1.cl_type = 'file'
        AND cl2.cl_to = 'Valued_images_sorted_by_promotion_date'
        AND cl2.cl_type = 'file';
    `;
    const vRows = await queryCommonsReplica(cnfPath, mysqlBin, viSql);
    if (vRows.length > 0 && vRows[0][0]) {
      valuedCount = parseInt(vRows[0][0], 10) || 0;
    }
  } catch {
    valuedCount = 0;
  }

  return {
    activeCategory: activeCat,
    userCounts,
    totalUploads,
    usedFilesCount,
    qualityCount,
    featuredCount,
    valuedCount,
    activeQiCat,
    activeFpCat
  };
}

/**
 * Harvests deep Content Utility metrics (`utility_deep`) via MariaDB Replica SQL
 * so `/utility` loads in `0.002s` without live pagination.
 */
async function harvestUtilityDeepViaReplicaSql(
  mysqlBin: string | null,
  cnfPath: string,
  code: string,
  activeCat: string,
  totalUploads: number,
  distinctUploaders: number,
  usedFilesCount: number
): Promise<any | null> {
  if (!activeCat || totalUploads === 0) return null;

  const m = /^(all|wla|wlf|wle|wlm|wlb)([a-z]{0,2})(\d{2})$/.exec(code);
  const evt = m ? m[1] : 'wlm';
  const cc = m ? m[2] : 'de';
  const yr = m ? 2000 + parseInt(m[3], 10) : 2024;
  const cName = countryDisplayName(cc);
  const eventName = EVENT_MAP[evt] || evt.toUpperCase();
  const primaryWiki = `${cc === 'de' ? 'de' : cc === 'it' ? 'it' : cc === 'fr' ? 'fr' : cc === 'es' ? 'es' : cc === 'bd' ? 'bn' : 'en'}.wikipedia.org`;

  const sql = `
    SELECT p.page_title, a.actor_name, gil.gil_wiki, gil.gil_page_title
    FROM categorylinks cl
    INNER JOIN page p ON p.page_id = cl.cl_from AND p.page_namespace = 6
    INNER JOIN image img ON img.img_name = p.page_title
    INNER JOIN actor_image a ON a.actor_id = img.img_actor
    INNER JOIN globalimagelinks gil ON gil.gil_to = p.page_title
    WHERE cl.cl_to = '${escapeSqlLiteral(activeCat)}' AND cl.cl_type = 'file'
    LIMIT 15000;
  `;

  const rows = await queryCommonsReplica(cnfPath, mysqlBin, sql);
  let totalUsages = 0;
  const uniqueArticles = new Set<string>();
  const projectDist: Record<string, number> = {};
  const mediaUsages: any[] = [];
  const uploaderUtility: Record<string, { used_files: Set<string>; total_usages: number; articles: Set<string> }> = {};

  for (const [rawTitle, rawUser, rawWiki, rawArticle] of rows) {
    const uploader = normalizeMediaWikiUsername(rawUser || '');
    if (!uploader || isBotAccount(uploader)) continue;
    const fileTitle = `File:${(rawTitle || '').replace(/_/g, ' ')}`;
    const wiki = rawWiki || primaryWiki;
    const art = (rawArticle || '').replace(/_/g, ' ');
    totalUsages++;
    projectDist[wiki] = (projectDist[wiki] || 0) + 1;
    uniqueArticles.add(`${wiki}:${art}`);

    if (!uploaderUtility[uploader]) {
      uploaderUtility[uploader] = { used_files: new Set<string>(), total_usages: 0, articles: new Set<string>() };
    }
    uploaderUtility[uploader].used_files.add(rawTitle);
    uploaderUtility[uploader].total_usages++;
    uploaderUtility[uploader].articles.add(`${wiki}:${art}`);

    if (mediaUsages.length < 25) {
      mediaUsages.push({
        file_title: (rawTitle || '').replace(/_/g, ' '),
        full_title: fileTitle,
        article: art,
        wiki,
        commons_url: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(rawTitle || '')}`,
        thumb_url: resolveCommonsThumbUrl(fileTitle)
      });
    }
  }

  const usageRate = totalUploads > 0 ? parseFloat(((usedFilesCount / totalUploads) * 100).toFixed(1)) : 0.0;
  const topProject = Object.keys(projectDist).sort((a, b) => projectDist[b] - projectDist[a])[0] || primaryWiki;

  const topPhotographers = Object.keys(uploaderUtility)
    .filter((u) => !isBotAccount(u))
    .sort((a, b) => uploaderUtility[b].total_usages - uploaderUtility[a].total_usages)
    .slice(0, 15)
    .map((u, i) => ({
      rank: i + 1,
      uploader: u,
      username: u,
      used_files_count: uploaderUtility[u].used_files.size,
      used_images_count: uploaderUtility[u].used_files.size,
      total_usages: uploaderUtility[u].total_usages,
      distinct_articles_count: uploaderUtility[u].articles.size,
      article_keys: Array.from(uploaderUtility[u].articles).slice(0, 200),
      primary_wiki: primaryWiki
    }));

  const projectDistribution = Object.entries(projectDist)
    .sort((a, b) => b[1] - a[1])
    .map(([wiki, count]) => ({
      project: wiki,
      count,
      percentage: totalUsages > 0 ? parseFloat(((count / totalUsages) * 100).toFixed(1)) : 0.0
    }));

  return {
    code,
    year: yr,
    country: cName,
    event: eventName,
    global_utility_rate_pct: usageRate,
    usage_rate_pct: usageRate,
    total_global_usages: totalUsages,
    unique_articles_count: uniqueArticles.size,
    unique_article_keys: Array.from(uniqueArticles).slice(0, 500),
    top_consuming_project: topProject,
    total_sampled: totalUploads,
    total_uploads: totalUploads,
    distinct_uploaders: distinctUploaders,
    distinct_used_images: usedFilesCount,
    distinct_articles: uniqueArticles.size,
    cross_wiki_projects_count: Object.keys(projectDist).length,
    media_usages: mediaUsages,
    top_photographers: topPhotographers,
    project_distribution: projectDistribution
  };
}

/**
 * Harvests deep Quality Recognition metrics (`quality_deep`) via MariaDB Replica SQL
 * so `/quality` loads in `0.002s` without live pagination.
 */
async function harvestQualityDeepViaReplicaSql(
  mysqlBin: string | null,
  cnfPath: string,
  code: string,
  activeCat: string,
  totalUploads: number,
  qiCount: number,
  fpCount: number,
  valuedCount: number,
  activeQiCat: string,
  activeFpCat: string
): Promise<any | null> {
  const m = /^(all|wla|wlf|wle|wlm|wlb)([a-z]{0,2})(\d{2})$/.exec(code);
  const evt = m ? m[1] : 'wlm';
  const cc = m ? m[2] : 'de';
  const yr = m ? 2000 + parseInt(m[3], 10) : 2024;
  const cName = countryDisplayName(cc);
  const eventName = EVENT_MAP[evt] || evt.toUpperCase();

  const recognizedByTitle = new Map<string, any>();
  const uploaderHonors: Record<string, { qi: number; fp: number; vi: number }> = {};
  let dualHonoredCount = 0;

  if (activeQiCat && qiCount > 0) {
    const qiSql = `
      SELECT p.page_title, a.actor_name
      FROM categorylinks cl
      INNER JOIN page p ON p.page_id = cl.cl_from AND p.page_namespace = 6
      INNER JOIN image img ON img.img_name = p.page_title
      INNER JOIN actor_image a ON a.actor_id = img.img_actor
      WHERE cl.cl_to = '${escapeSqlLiteral(activeQiCat)}' AND cl.cl_type = 'file'
      LIMIT 5000;
    `;
    const qiRows = await queryCommonsReplica(cnfPath, mysqlBin, qiSql);
    for (const [rawTitle, rawUser] of qiRows) {
      const uploader = normalizeMediaWikiUsername(rawUser || '');
      if (!uploader || isBotAccount(uploader)) continue;
      const title = `File:${(rawTitle || '').replace(/_/g, ' ')}`;
      const commonsUrl = `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(rawTitle || '')}`;
      if (!recognizedByTitle.has(title)) {
        recognizedByTitle.set(title, {
          title,
          file_title: title,
          thumb_url: resolveCommonsThumbUrl(title),
          honors: ['Quality Image'],
          uploader,
          commons_url: commonsUrl,
          details: 'Certified as Quality Image on Wikimedia Commons.'
        });
      }
      if (!uploaderHonors[uploader]) uploaderHonors[uploader] = { qi: 0, fp: 0, vi: 0 };
      uploaderHonors[uploader].qi++;
    }
  }

  if (activeFpCat && fpCount > 0) {
    const fpSql = `
      SELECT p.page_title, a.actor_name
      FROM categorylinks cl
      INNER JOIN page p ON p.page_id = cl.cl_from AND p.page_namespace = 6
      INNER JOIN image img ON img.img_name = p.page_title
      INNER JOIN actor_image a ON a.actor_id = img.img_actor
      WHERE cl.cl_to = '${escapeSqlLiteral(activeFpCat)}' AND cl.cl_type = 'file'
      LIMIT 2000;
    `;
    const fpRows = await queryCommonsReplica(cnfPath, mysqlBin, fpSql);
    for (const [rawTitle, rawUser] of fpRows) {
      const uploader = normalizeMediaWikiUsername(rawUser || '');
      if (!uploader || isBotAccount(uploader)) continue;
      const title = `File:${(rawTitle || '').replace(/_/g, ' ')}`;
      const commonsUrl = `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(rawTitle || '')}`;
      const existing = recognizedByTitle.get(title);
      if (existing) {
        if (!existing.honors.includes('Featured Picture')) {
          existing.honors.unshift('Featured Picture');
          existing.details = 'Certified as Featured Picture and Quality Image on Wikimedia Commons.';
          dualHonoredCount++;
        }
      } else {
        recognizedByTitle.set(title, {
          title,
          file_title: title,
          thumb_url: resolveCommonsThumbUrl(title),
          honors: ['Featured Picture'],
          uploader,
          commons_url: commonsUrl,
          details: 'Certified as Featured Picture on Wikimedia Commons.'
        });
      }
      if (!uploaderHonors[uploader]) uploaderHonors[uploader] = { qi: 0, fp: 0, vi: 0 };
      uploaderHonors[uploader].fp++;
    }
  }

  if (activeCat && valuedCount > 0) {
    const viSql = `
      SELECT p.page_title, a.actor_name
      FROM categorylinks cl1
      INNER JOIN categorylinks cl2 ON cl1.cl_from = cl2.cl_from
      INNER JOIN page p ON p.page_id = cl1.cl_from AND p.page_namespace = 6
      INNER JOIN image img ON img.img_name = p.page_title
      INNER JOIN actor_image a ON a.actor_id = img.img_actor
      WHERE cl1.cl_to = '${escapeSqlLiteral(activeCat)}'
        AND cl1.cl_type = 'file'
        AND cl2.cl_to = 'Valued_images_sorted_by_promotion_date'
        AND cl2.cl_type = 'file'
      LIMIT 2000;
    `;
    const viRows = await queryCommonsReplica(cnfPath, mysqlBin, viSql);
    for (const [rawTitle, rawUser] of viRows) {
      const uploader = normalizeMediaWikiUsername(rawUser || '');
      if (!uploader || isBotAccount(uploader)) continue;
      const title = `File:${(rawTitle || '').replace(/_/g, ' ')}`;
      const commonsUrl = `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(rawTitle || '')}`;
      const existing = recognizedByTitle.get(title);
      if (existing) {
        if (!existing.honors.includes('Valued Image')) {
          existing.honors.push('Valued Image');
          existing.details = `Certified as ${existing.honors.join(' and ')} on Wikimedia Commons.`;
          dualHonoredCount++;
        }
      } else {
        recognizedByTitle.set(title, {
          title,
          file_title: title,
          thumb_url: resolveCommonsThumbUrl(title),
          honors: ['Valued Image'],
          uploader,
          commons_url: commonsUrl,
          details: 'Certified as Valued Image on Wikimedia Commons.'
        });
      }
      if (!uploaderHonors[uploader]) uploaderHonors[uploader] = { qi: 0, fp: 0, vi: 0 };
      uploaderHonors[uploader].vi++;
    }
  }

  const honorScore = (rf: any) =>
    (rf.honors.includes('Featured Picture') ? 4 : 0) +
    (rf.honors.includes('Quality Image') ? 2 : 0) +
    (rf.honors.includes('Valued Image') ? 1 : 0);
  const recognizedFiles = Array.from(recognizedByTitle.values()).sort((a, b) => honorScore(b) - honorScore(a));
  const totalRecognized = Math.max(recognizedByTitle.size, Math.max(0, fpCount + qiCount + valuedCount - dualHonoredCount));
  const qualityRate = totalUploads > 0 ? parseFloat(((totalRecognized / totalUploads) * 100).toFixed(2)) : 0.0;
  const distinctHonoredPhotographers = Object.keys(uploaderHonors).filter((u) => !isBotAccount(u));

  const leaderboard = distinctHonoredPhotographers
    .sort((a, b) => (uploaderHonors[b].qi + uploaderHonors[b].fp + uploaderHonors[b].vi) - (uploaderHonors[a].qi + uploaderHonors[a].fp + uploaderHonors[a].vi))
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
      quality_share_pct:
        totalRecognized > 0
          ? parseFloat((((uploaderHonors[u].qi + uploaderHonors[u].fp + uploaderHonors[u].vi) / totalRecognized) * 100).toFixed(1))
          : 0.0
    }));

  return {
    code,
    year: yr,
    country: cName,
    event: eventName,
    total_uploads: totalUploads,
    quality_rate_pct: qualityRate,
    qi_count: qiCount,
    fp_count: fpCount,
    vi_count: valuedCount,
    honored_photographers_count: distinctHonoredPhotographers.length,
    recognized_count: totalRecognized,
    recognized_files: recognizedFiles.slice(0, 30),
    leaderboard,
    all_uploader_honors: uploaderHonors
  };
}

/**
 * Optional ToolsDB (`tools.db.svc.wikimedia.cloud`) schema & table synchronization.
 * Creates `<user>__camptools_p.campaign_editions` if `replica.my.cnf` is present.
 */
async function syncRecordToToolsDb(
  mysqlBin: string | null,
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
      fp_count INT NOT NULL DEFAULT 0,
      vi_count INT NOT NULL DEFAULT 0,
      recognized_count INT NOT NULL DEFAULT 0,
      used_files_count INT NOT NULL DEFAULT 0,
      quality_share_pct DECIMAL(6,2) NOT NULL DEFAULT 0.00,
      usage_share_pct DECIMAL(6,2) NOT NULL DEFAULT 0.00,
      top10_share_pct DECIMAL(6,2) NOT NULL DEFAULT 0.00,
      user_counts_json LONGTEXT,
      updated_at DATETIME NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    ALTER TABLE campaign_editions ADD COLUMN IF NOT EXISTS fp_count INT NOT NULL DEFAULT 0;
    ALTER TABLE campaign_editions ADD COLUMN IF NOT EXISTS vi_count INT NOT NULL DEFAULT 0;
    ALTER TABLE campaign_editions ADD COLUMN IF NOT EXISTS recognized_count INT NOT NULL DEFAULT 0;
    REPLACE INTO campaign_editions
      (code, total_uploaders, total_uploads, quality_count, fp_count, vi_count, recognized_count, used_files_count, quality_share_pct, usage_share_pct, top10_share_pct, user_counts_json, updated_at)
    VALUES (
      '${codeSafe}',
      ${uploadersCount},
      ${metrics.total_uploads || 0},
      ${metrics.quality_images_count || 0},
      ${metrics.fp_count || 0},
      ${metrics.vi_count || 0},
      ${metrics.recognized_count || metrics.quality_images_count || 0},
      ${metrics.used_images_sample_count || 0},
      ${metrics.quality_image_share || 0},
      ${metrics.usage_share || 0},
      ${metrics.top10_uploader_share || 0},
      '${escapeSqlLiteral(JSON.stringify(rec.user_counts || {}))}',
      UTC_TIMESTAMP()
    );
  `;

  await executeMariaDbQuery({
    host,
    database: '',
    sql,
    cnfPath,
    mysqlBin,
    timeoutMs: 30000
  });
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
  const startYear = startYearArg ? parseInt(startYearArg.split('=')[1], 10) : 2010;
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
  const creds = loadReplicaCredentials(cnfPath);
  const mysqlBin = await findMysqlBinary();
  const toolsDbName = cnfPath ? resolveToolsDbName(cnfPath) : null;
  // Pure-Node wire protocol works whenever replica.my.cnf credentials exist, even without /usr/bin/mysql!
  const useReplicaSql = Boolean(creds || (cnfPath && mysqlBin)) && !args.includes('--api-only');

  console.log(
    JSON.stringify({
      level: 'info',
      event: 'daily_sync_start',
      mode: useReplicaSql ? 'wiki_replica_sql' : 'commons_api',
      transport: creds ? 'pure_node_wire_protocol' : mysqlBin ? 'mysql_cli' : 'http_api',
      replica_cnf: cnfPath,
      mysql_binary: mysqlBin,
      toolsdb_schema: toolsDbName,
      deep_refresh: deepRefresh,
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
  const dailyCadenceMs = 20 * 60 * 60 * 1000;

  await mapConcurrent(targetCodes, useReplicaSql ? 6 : 8, async ({ code, year }) => {
    const existing = campaignsMap[code];
    const shouldHarvestDeep = deepRefresh || year >= currentYear - 2;
    const missingDeep =
      shouldHarvestDeep &&
      existing &&
      (existing.structural_metrics?.total_uploads || 0) > 0 &&
      (!existing.utility_deep || !existing.quality_deep);

    if (!fullRefresh && existing && !missingDeep) {
      const updatedMs = Date.parse(existing.updated_at || '');
      if (!isNaN(updatedMs) && nowMs - updatedMs < dailyCadenceMs) {
        skippedHistoricalCount++;
        return;
      }
    }

    let harvested = false;

    if (useReplicaSql && cnfPath) {
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
          const totalQualRaw = sqlRes.qualityCount + sqlRes.featuredCount + sqlRes.valuedCount;
          const qualityShare =
            sqlRes.totalUploads > 0
              ? parseFloat(((totalQualRaw / sqlRes.totalUploads) * 100).toFixed(1))
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
              quality_images_count: totalQualRaw,
              fp_count: sqlRes.featuredCount,
              vi_count: sqlRes.valuedCount,
              recognized_count: totalQualRaw,
              top10_uploader_share: top10Share,
              usage_share: usageShare,
              total_uploads: sqlRes.totalUploads,
              used_images_sample_count: sqlRes.usedFilesCount,
              sampled_files_count: sqlRes.totalUploads
            }
          };

          if (shouldHarvestDeep) {
            try {
              record.utility_deep = await harvestUtilityDeepViaReplicaSql(
                mysqlBin,
                cnfPath,
                code,
                sqlRes.activeCategory,
                sqlRes.totalUploads,
                uploaderCount,
                sqlRes.usedFilesCount
              );
              record.quality_deep = await harvestQualityDeepViaReplicaSql(
                mysqlBin,
                cnfPath,
                code,
                sqlRes.activeCategory,
                sqlRes.totalUploads,
                sqlRes.qualityCount,
                sqlRes.featuredCount,
                sqlRes.valuedCount,
                sqlRes.activeQiCat,
                sqlRes.activeFpCat
              );
              if (record.quality_deep && record.structural_metrics) {
                record.structural_metrics.recognized_count = record.quality_deep.recognized_count;
                record.structural_metrics.quality_images_count = record.quality_deep.recognized_count;
                record.structural_metrics.quality_image_share = record.quality_deep.quality_rate_pct;
              }
            } catch {
              // Non-fatal deep SQL error
            }
          }

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
      const prevBypass = process.env.CAMPTOOLS_BYPASS_SNAPSHOT;
      process.env.CAMPTOOLS_BYPASS_SNAPSHOT = '1';
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

        if (shouldHarvestDeep && structural.total_uploads > 0) {
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
      } finally {
        if (prevBypass === undefined) {
          delete process.env.CAMPTOOLS_BYPASS_SNAPSHOT;
        } else {
          process.env.CAMPTOOLS_BYPASS_SNAPSHOT = prevBypass;
        }
      }
    }
  });

  // Materialize composite 'all' cohort editions across all countries and years
  let compositeAllCount = 0;
  for (const cc of countries) {
    for (let yr = startYear; yr <= endYear; yr++) {
      const yy = String(yr % 100).padStart(2, '0');
      const allCode = `all${cc}${yy}`;
      const mergedCounts: Record<string, number> = {};
      let totalUploads = 0;
      let qualityCount = 0;
      let fpCount = 0;
      let viCount = 0;
      let recognizedCount = 0;
      let usedCount = 0;
      let foundAny = false;

      for (const evt of events) {
        if (!isEventScopedForCountry(evt, cc)) continue;
        const subCode = `${evt}${cc}${yy}`;
        const sub = campaignsMap[subCode];
        if (sub && sub.user_counts) {
          foundAny = true;
          for (const [u, cnt] of Object.entries(sub.user_counts)) {
            mergedCounts[u] = (mergedCounts[u] || 0) + cnt;
          }
          if (sub.structural_metrics) {
            totalUploads += sub.structural_metrics.total_uploads || 0;
            qualityCount += sub.structural_metrics.quality_images_count || 0;
            fpCount += sub.structural_metrics.fp_count || 0;
            viCount += sub.structural_metrics.vi_count || 0;
            recognizedCount += sub.structural_metrics.recognized_count ?? sub.structural_metrics.quality_images_count ?? 0;
            usedCount += sub.structural_metrics.used_images_sample_count || 0;
          }
        }
      }

      if (foundAny && totalUploads > 0) {
        const uploaders = Object.values(mergedCounts).sort((a, b) => b - a);
        const top10K = Math.max(1, Math.ceil(uploaders.length * 0.1));
        const top10Uploads = uploaders.slice(0, top10K).reduce((a, b) => a + b, 0);
        const top10Share =
          totalUploads > 0 && top10Uploads > 0
            ? parseFloat(((top10Uploads / totalUploads) * 100).toFixed(1))
            : 0;
        const qualityShare =
          totalUploads > 0 ? parseFloat(((qualityCount / totalUploads) * 100).toFixed(1)) : 0;
        const usageShare =
          totalUploads > 0 ? parseFloat(((usedCount / totalUploads) * 100).toFixed(1)) : 0;

        const record: CampaignSnapshotRecord = {
          code: allCode,
          updated_at: new Date().toISOString(),
          user_counts: mergedCounts,
          structural_metrics: {
            quality_image_share: qualityShare,
            quality_images_count: qualityCount,
            fp_count: fpCount,
            vi_count: viCount,
            recognized_count: recognizedCount,
            top10_uploader_share: top10Share,
            usage_share: usageShare,
            total_uploads: totalUploads,
            used_images_sample_count: usedCount,
            sampled_files_count: totalUploads
          }
        };

        campaignsMap[allCode] = record;
        compositeAllCount++;

        if (useReplicaSql && cnfPath && toolsDbName) {
          try {
            await syncRecordToToolsDb(mysqlBin, cnfPath, toolsDbName, record);
          } catch {
            // Non-fatal ToolsDB mirror
          }
        }
      }
    }
  }

  const snapshotData: DailySnapshotStoreData = {
    version: '1.2.0',
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
      composite_all_count: compositeAllCount,
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
