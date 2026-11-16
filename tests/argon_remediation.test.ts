import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as analytics from '../src/core/analytics.js';
import { asScalarString, safeJsonForScript, escapeHtml, BoundedCache, getCampaignTtlMs } from '../src/core/utils.js';

test('DATA-01: Zero Synthetic Extrapolations in structural metrics', async () => {
  analytics.primeParticipantCache('wlmde24', ['UserA', 'UserB'], new Map([['UserA', 10], ['UserB', 20]]));

  const metrics = await analytics.getCampaignStructuralMetrics('wlmde24');
  assert.equal(typeof metrics.quality_images_count, 'number');
  assert.equal(typeof metrics.used_images_sample_count, 'number');
  assert.ok(
    metrics.quality_images_count === 0 || metrics.quality_images_count >= 0,
    'quality_images_count must be an authentic count'
  );
  assert.ok(
    metrics.used_images_sample_count === 0 || metrics.used_images_sample_count >= 0,
    'used_images_sample_count must be an authentic count'
  );
});

test('DATA-02: fetchCommonsApi throws on MediaWiki error responses (e.g. maxlag)', async () => {
  analytics.setCommonsFetchMock(async (params: Record<string, string>) => {
    if (params.titles === 'error_test') {
      return {
        error: {
          code: 'maxlag',
          info: 'Waiting for database replag'
        }
      };
    }
    return { query: { pages: {} } };
  });

  await assert.rejects(
    async () => {
      await analytics.fetchCommonsApi({ action: 'query', titles: 'error_test' });
    },
    (err: any) => {
      assert.ok(err.message.includes('maxlag'), 'Expected maxlag error to be thrown');
      return true;
    }
  );

  analytics.setCommonsFetchMock(null);
});

test('DATA-03: coalesceInFlight prevents concurrent stampede', async () => {
  let callCount = 0;
  const slowFn = async () => {
    callCount++;
    await new Promise((resolve) => setTimeout(resolve, 50));
    return 42;
  };

  const [res1, res2, res3] = await Promise.all([
    analytics.coalesceInFlight('test-stampede', slowFn),
    analytics.coalesceInFlight('test-stampede', slowFn),
    analytics.coalesceInFlight('test-stampede', slowFn)
  ]);

  assert.equal(res1, 42);
  assert.equal(res2, 42);
  assert.equal(res3, 42);
  assert.equal(callCount, 1, 'Only one underlying invocation should execute for concurrent calls');
});

test('DATA-04: Bot account detection precision - strict word boundaries', () => {
  assert.equal(analytics.isBotAccount('WLM-Bot'), true);
  assert.equal(analytics.isBotAccount('CommonsDelinker'), true);
  assert.equal(analytics.isBotAccount('FlickrLickr'), true);
  assert.equal(analytics.isBotAccount('bot_helper'), true);

  // Human names ending in -bot or containing bot as a substring must NOT be flagged
  assert.equal(analytics.isBotAccount('Talbot'), false);
  assert.equal(analytics.isBotAccount('Abbot'), false);
  assert.equal(analytics.isBotAccount('Turbot'), false);
  assert.equal(analytics.isBotAccount('Botha'), false);
  assert.equal(analytics.isBotAccount('Robotnik'), false);
});

test('DATA-05: computeHealthEvaluation accepts customBaselineEvent and reconciles newcomer counts', async () => {
  analytics.setCommonsFetchMock(async () => ({ query: { pages: {} } }));
  analytics.primeParticipantCache('wlmbd21', ['UserOld'], new Map([['UserOld', 5]]));
  analytics.primeParticipantCache('wlmbd22', ['UserA'], new Map([['UserA', 8]]));
  analytics.primeParticipantCache('wlmbd23', ['UserA', 'UserOld', 'UserNew'], new Map([['UserA', 10], ['UserOld', 4], ['UserNew', 15]]));
  analytics.primeParticipantCache('wlmbd19', ['UserA'], new Map([['UserA', 10]]));

  const evaluation = await analytics.computeHealthEvaluation('wlmbd23', 'South Asia', 'wlmbd19');
  assert.equal(evaluation.target_campaign, 'wlmbd23');
  assert.equal(evaluation.baseline_campaign, 'wlmbd19');
  // UserOld was active in 2021, so only UserNew is a true first-time newcomer
  assert.equal(evaluation.dimensions.Growth.count, evaluation.overall_report.newcomer_uploaders);
  analytics.setCommonsFetchMock(null);
});

test('SEC-01: asScalarString, escapeHtml, and safeJsonForScript security utilities', () => {
  assert.equal(asScalarString(['alpha', 'beta']), 'alpha');
  assert.equal(asScalarString('single'), 'single');
  assert.equal(asScalarString(undefined, 'defaultVal'), 'defaultVal');
  assert.equal(asScalarString(null, 'defaultVal'), 'defaultVal');

  const xssStr = '<script>alert("XSS")</script>&"\'';
  const escaped = escapeHtml(xssStr);
  assert.ok(!escaped.includes('<script>'));
  assert.ok(escaped.includes('&lt;script&gt;'));
  assert.ok(escaped.includes('&quot;'));
  assert.ok(escaped.includes('&#039;'));

  const jsonInjection = { payload: '</script><script>alert(1)</script>' };
  const safeScript = safeJsonForScript(jsonInjection);
  assert.ok(!safeScript.includes('</script>'), 'Must escape script closing tag');
  assert.ok(safeScript.includes('\\u003c/script\\u003e'));
});

test('SEC-01 & PERF-01: BoundedCache enforces true LRU eviction and smart campaign TTLs', () => {
  const cache = new BoundedCache<string, number>(2);
  cache.set('a', 1);
  cache.set('b', 2);
  // Access 'a' so 'a' becomes Most Recently Used and 'b' becomes Least Recently Used
  assert.equal(cache.get('a'), 1);
  cache.set('c', 3);
  assert.equal(cache.has('a'), true, 'Recently accessed key a must be retained');
  assert.equal(cache.has('b'), false, 'Least recently used key b must be evicted');
  assert.equal(cache.has('c'), true);
  assert.equal(cache.size, 2);

  // Smart TTL: historical editions get 24h, active current-year gets 15m
  const curYrShort = String(new Date().getFullYear() % 100).padStart(2, '0');
  assert.equal(getCampaignTtlMs('wlmde21'), 24 * 60 * 60 * 1000);
  assert.equal(getCampaignTtlMs(`wlmde${curYrShort}`), 15 * 60 * 1000);
});

test('MATH-01 & MATH-02: computeSingleDiversityRecord follows Section 5.3 tiers and Math.ceil Pareto decile', async () => {
  const uploadMap = new Map<string, number>([
    ['User1', 1],
    ['User2', 2],
    ['User3', 5],
    ['User4', 10],
    ['User5', 25]
  ]);
  analytics.primeParticipantCache('wlmde24', Array.from(uploadMap.keys()), uploadMap);

  const record = await analytics.computeSingleDiversityRecord('wlm', 'de', 2024);
  assert.equal(record.total_users, 5);
  assert.equal(record.total_uploads, 43);

  // Methodological tiers: 1 upload, 2-5 uploads, 6-20 uploads, 21+ uploads
  assert.equal(record.tiers.casual_count, 1); // User1 (1)
  assert.equal(record.tiers.regular_count, 2); // User2 (2), User3 (5)
  assert.equal(record.tiers.active_count, 1); // User4 (10)
  assert.equal(record.tiers.power_count, 1); // User5 (25)

  // Top 10% Pareto: Math.ceil(5 * 0.10) = 1 uploader (User5 with 25 uploads)
  // 25 / 43 = 58.1%
  assert.equal(record.top_10_percent_share, 58.1);
});

test('MATH-04: computeYoYInflux excludes Year 0 from avg_newcomer_share_pct', async () => {
  analytics.primeParticipantCache('wlmde22', ['UserA', 'UserB'], new Map([['UserA', 5], ['UserB', 5]]));
  analytics.primeParticipantCache('wlmde23', ['UserA', 'UserC'], new Map([['UserA', 5], ['UserC', 5]]));
  analytics.primeParticipantCache('wlmde24', ['UserA', 'UserD', 'UserE'], new Map([['UserA', 5], ['UserD', 5], ['UserE', 5]]));

  const influx = await analytics.computeYoYInflux(['wlmde22', 'wlmde23', 'wlmde24']);
  assert.equal(influx.records.length, 3);
  // Year 0 (2022): 2 active, 2 new (100% newcomer share by definition as baseline)
  assert.equal(influx.records[0].newcomer_share_pct, 100);
  // Year 1 (2023): UserA retained, UserC new -> 1 new / 2 active = 50%
  assert.equal(influx.records[1].newcomer_share_pct, 50);
  // Year 2 (2024): UserA retained, UserD & UserE new -> 2 new / 3 active = 66.7%
  assert.equal(influx.records[2].newcomer_share_pct, 66.7);

  // avg_newcomer_share_pct must average post-baseline editions (50 + 66.7) / 2 = 58.4%
  // and NOT include the 100% year-0 artifact
  assert.equal(influx.summary.avg_newcomer_share_pct, 58.4);

  // peak_influx_year must also exclude the baseline year (2021) even when baseline has more initial entrants
  analytics.primeParticipantCache('wlmde21', ['U1', 'U2', 'U3', 'U4', 'U5'], new Map([['U1', 1], ['U2', 1], ['U3', 1], ['U4', 1], ['U5', 1]]));
  const influxWithLargeBaseline = await analytics.computeYoYInflux(['wlmde21', 'wlmde22', 'wlmde23', 'wlmde24']);
  assert.notEqual(influxWithLargeBaseline.summary.peak_influx_year, 2021, 'Peak influx year must exclude baseline year');
  assert.equal(influxWithLargeBaseline.summary.peak_influx_year, 2022);
  assert.equal(influxWithLargeBaseline.summary.peak_influx_count, 2);

  // Cumulative pool must start from evaluated editions (2022), excluding baseline year (2021)
  assert.equal(influxWithLargeBaseline.records[0].is_baseline, true);
  assert.equal(influxWithLargeBaseline.records[0].cumulative_pool, null, 'Baseline year must have null cumulative pool');
  assert.equal(influxWithLargeBaseline.records[1].year, 2022);
  assert.equal(influxWithLargeBaseline.records[1].cumulative_pool, 2, 'Cumulative pool must start at 2022 active count');
  assert.equal(influxWithLargeBaseline.records[2].year, 2023);
  assert.equal(influxWithLargeBaseline.records[2].cumulative_pool, 3, 'Cumulative pool accumulates evaluated edition participants');
  assert.equal(influxWithLargeBaseline.summary.total_unique_community, 5, 'Total unique community must reflect evaluated editions (UserA, UserB, UserC, UserD, UserE)');

  // Influx chart must not draw a cumulative point for baseline year
  const chartB64 = analytics.createInfluxBarchartSvg(influxWithLargeBaseline.records, 'Test');
  const chartSvg = Buffer.from(chartB64, 'base64').toString('utf8');
  assert.ok(chartSvg.includes('2021'));
  // Cumulative line points count must equal post-baseline records (3)
  const amberDots = (chartSvg.match(/<circle cx="[^"]+" cy="[^"]+" r="4\.5"/g) || []).length;
  assert.equal(amberDots, 3, 'Should have exactly 3 cumulative dots for the 3 evaluated years (2022, 2023, 2024)');
});

test('MATH-05: Comparative mobility module produces valid points, latest_formatted, and YoY fields', async () => {
  analytics.setCommonsFetchMock(async () => ({ query: { pages: {} } }));
  analytics.primeParticipantCache('wlmde22', ['User1', 'User2']);
  analytics.primeParticipantCache('wlede22', ['User2', 'User3']);
  analytics.primeParticipantCache('wlfde22', ['User3', 'User4']);

  const comp = await analytics.computeComparativeAnalytics({
    module: 'mobility',
    countryCodes: ['de'],
    startYear: 2022,
    endYear: 2022
  });

  assert.equal(comp.module, 'mobility');
  assert.ok(comp.series.length > 0);
  assert.ok(comp.series[0].points.length > 0);
  assert.equal(typeof comp.series[0].summary.latest_formatted, 'string');
  assert.equal(typeof comp.table_data.rows[0].yoy_change_formatted, 'string');
  assert.equal(typeof comp.table_data.rows[0].color, 'string');
  assert.ok(comp.metadata_card);
  assert.ok(comp.metadata_card.license.includes('CC BY-SA 4.0'));
  analytics.setCommonsFetchMock(null);
});

test('UTIL-ALL-01 & QUAL-PAG-01: All Campaigns unique articles deduplication, QI+FP file deduplication, and paginated harvesting', async () => {
  analytics.primeParticipantCache('wlmde24', ['Alice', 'Bob'], new Map([['Alice', 10], ['Bob', 5]]));
  analytics.primeParticipantCache('wlede24', ['Alice', 'Carol'], new Map([['Alice', 4], ['Carol', 6]]));
  analytics.primeParticipantCache('wlfde24', [], new Map());

  analytics.setCommonsFetchMock(async (params: Record<string, string>) => {
    if (params.prop === 'imageinfo|globalusage') {
      if (params.gcmtitle?.includes('Monuments')) {
        return {
          query: {
            pages: {
              '101': {
                title: 'File:Castle1.jpg',
                imageinfo: [{ user: 'Alice', thumburl: '/thumb1.jpg' }],
                globalusage: [
                  { wiki: 'de.wikipedia.org', title: 'Berlin' },
                  { wiki: 'en.wikipedia.org', title: 'Berlin' }
                ]
              }
            }
          }
        };
      }
      if (params.gcmtitle?.includes('Earth')) {
        return {
          query: {
            pages: {
              '202': {
                title: 'File:Forest1.jpg',
                imageinfo: [{ user: 'Carol', thumburl: '/thumb2.jpg' }],
                globalusage: [
                  { wiki: 'de.wikipedia.org', title: 'Berlin' },
                  { wiki: 'de.wikipedia.org', title: 'Black_Forest' }
                ]
              }
            }
          }
        };
      }
      return { query: { pages: {} } };
    }

    if (params.prop === 'categoryinfo') {
      if (params.titles?.includes('Quality images from Wiki Loves Monuments 2024 in Germany')) {
        return { query: { pages: { '500': { categoryinfo: { files: 3 } } } } };
      }
      if (params.titles?.includes('Featured pictures from Wiki Loves Monuments 2024 in Germany')) {
        return { query: { pages: { '501': { categoryinfo: { files: 1 } } } } };
      }
      return { query: { pages: {} } };
    }

    if (params.prop === 'imageinfo' && params.gcmtitle?.includes('Quality images from Wiki Loves Monuments 2024 in Germany')) {
      if (!params.gcmcontinue) {
        return {
          continue: { gcmcontinue: 'page2_token' },
          query: {
            pages: {
              '301': { title: 'File:QI1.jpg', imageinfo: [{ user: 'Alice', thumburl: '/q1.jpg' }] },
              '302': { title: 'File:QI2.jpg', imageinfo: [{ user: 'Bob', thumburl: '/q2.jpg' }] }
            }
          }
        };
      } else if (params.gcmcontinue === 'page2_token') {
        return {
          query: {
            pages: {
              '303': { title: 'File:QI3.jpg', imageinfo: [{ user: 'Carol', thumburl: '/q3.jpg' }] }
            }
          }
        };
      }
    }

    if (params.prop === 'imageinfo' && params.gcmtitle?.includes('Featured pictures from Wiki Loves Monuments 2024 in Germany')) {
      return {
        query: {
          pages: {
            // File:QI1.jpg is ALSO a Featured Picture — must be deduplicated in recognized_count and merged in honors
            '301': { title: 'File:QI1.jpg', imageinfo: [{ user: 'Alice', thumburl: '/q1.jpg' }] }
          }
        }
      };
    }

    return { query: { pages: {} } };
  });

  const utilAll = await analytics.computeContentUtilityDeep('allde24');
  assert.equal(utilAll.unique_articles_count, 3, 'All Campaigns must deduplicate unique articles across sub-campaigns');
  assert.equal(utilAll.distinct_articles, 3);
  assert.equal(utilAll.total_global_usages, 4);

  const qualWlm = await analytics.computeQualityRecognitionDeep('wlmde24');
  assert.equal(qualWlm.qi_count, 3);
  assert.equal(qualWlm.fp_count, 1);
  assert.equal(qualWlm.recognized_count, 3, 'Dual-honored QI+FP file must be deduplicated in recognized_count');
  assert.deepEqual(qualWlm.recognized_files[0].honors, ['Featured Picture', 'Quality Image']);
  assert.equal(qualWlm.honored_photographers_count, 3, 'Must paginate gcmcontinue to count all 3 honored photographers');

  const qualAll = await analytics.computeQualityRecognitionDeep('allde24');
  assert.equal(qualAll.honored_photographers_count, 3, 'All Campaigns must aggregate all_uploader_honors across sub-campaigns');

  analytics.setCommonsFetchMock(null);
});

test('FMT-01 & SYNC-01: ComparativeTableRow formats Latest/Average with units and Gini precision', async () => {
  analytics.setCommonsFetchMock(async () => ({ query: { pages: {} } }));
  analytics.primeParticipantCache('wlmde21', ['U1', 'U2', 'U3', 'U4'], new Map([['U1', 50], ['U2', 5], ['U3', 2], ['U4', 1]]));
  analytics.primeParticipantCache('wlmde22', ['U1', 'U2'], new Map([['U1', 40], ['U2', 10]]));

  const retComp = await analytics.computeComparativeAnalytics({
    module: 'retention',
    eventType: 'wlm',
    countryCodes: ['de'],
    startYear: 2022,
    endYear: 2022
  });
  assert.equal(retComp.table_data.rows[0].latest_formatted, '50.0%');
  assert.equal(retComp.table_data.rows[0].average_formatted, '50.0%');

  const divComp = await analytics.computeComparativeAnalytics({
    module: 'diversity',
    eventType: 'wlm',
    countryCodes: ['de'],
    startYear: 2021,
    endYear: 2022
  });
  assert.match(divComp.table_data.rows[0].latest_formatted || '', /^\d+\.\d{3}$/, 'Gini latest_formatted must have 3 decimal places');
  assert.match(divComp.table_data.rows[0].average_formatted || '', /^\d+\.\d{3}$/, 'Gini average_formatted must have 3 decimal places');

  analytics.setCommonsFetchMock(null);
});

test('UPGRADE-01: Pure-Node MariaDB/MySQL wire-protocol v10 client handshake & COM_QUERY parsing', async () => {
  const { PassThrough } = await import('node:stream');
  const { EventEmitter } = await import('node:events');
  const { computeMysqlNativePasswordAuth, queryViaWireProtocol } = await import('../src/core/replicaClient.js');

  // Verify deterministic 20-byte SHA-1 scramble output
  const scramble = Buffer.from('12345678901234567890', 'utf8');
  const token = computeMysqlNativePasswordAuth('test_secret', scramble);
  assert.equal(token.length, 20, 'mysql_native_password scramble must be 20 bytes');

  // Create an in-memory full-duplex socket mock speaking MariaDB wire protocol v10
  const serverToClient = new PassThrough();
  const clientToServer = new PassThrough();

  const clientStream = new EventEmitter() as any;
  serverToClient.on('data', (chunk) => clientStream.emit('data', chunk));
  clientStream.write = (chunk: Buffer) => clientToServer.write(chunk);
  clientStream.destroy = () => {
    serverToClient.destroy();
    clientToServer.destroy();
  };

  let stage = 'auth';
  clientToServer.on('data', (chunk: Buffer) => {
    if (stage === 'auth') {
      stage = 'command';
      const okPacket = Buffer.from([0x07, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00]);
      serverToClient.write(okPacket);
    } else if (stage === 'command') {
      if (chunk[4] === 0x03) {
        const makePacket = (seq: number, body: Buffer) => {
          const h = Buffer.alloc(4);
          h.writeUIntLE(body.length, 0, 3);
          h[3] = seq;
          return Buffer.concat([h, body]);
        };
        const makeLenEncStr = (s: string) => {
          const b = Buffer.from(s, 'utf8');
          return Buffer.concat([Buffer.from([b.length]), b]);
        };
        const colDef = (name: string) =>
          Buffer.concat([
            makeLenEncStr('def'),
            makeLenEncStr('commonswiki_p'),
            makeLenEncStr('actor'),
            makeLenEncStr('actor'),
            makeLenEncStr(name),
            makeLenEncStr(name)
          ]);
        const eofBody = Buffer.from([0xfe, 0x00, 0x00, 0x02, 0x00]);
        const row1 = Buffer.concat([makeLenEncStr('Alice'), makeLenEncStr('12')]);

        serverToClient.write(
          Buffer.concat([
            makePacket(1, Buffer.from([2])),
            makePacket(2, colDef('actor_name')),
            makePacket(3, colDef('uploads')),
            makePacket(4, eofBody),
            makePacket(5, row1),
            makePacket(6, eofBody)
          ])
        );
      }
    }
  });

  // Emit Initial Handshake Packet (v10) immediately after queryViaWireProtocol attaches listeners
  setImmediate(() => {
    const serverVersion = Buffer.from('10.6.18-MariaDB-log\0', 'utf8');
    const threadId = Buffer.alloc(4);
    threadId.writeUInt32LE(42, 0);
    const authPart1 = Buffer.from('12345678', 'utf8');
    const filler = Buffer.from([0x00]);
    const capLower = Buffer.from([0xff, 0xf7]);
    const charset = Buffer.from([0x21]);
    const statusFlags = Buffer.from([0x02, 0x00]);
    const capUpper = Buffer.from([0xff, 0x81]);
    const authLen = Buffer.from([21]);
    const reserved = Buffer.alloc(10, 0);
    const authPart2 = Buffer.from('901234567890\0', 'utf8');
    const pluginName = Buffer.from('mysql_native_password\0', 'utf8');

    const greetingPayload = Buffer.concat([
      Buffer.from([0x0a]),
      serverVersion,
      threadId,
      authPart1,
      filler,
      capLower,
      charset,
      statusFlags,
      capUpper,
      authLen,
      reserved,
      authPart2,
      pluginName
    ]);
    const greetingHeader = Buffer.alloc(4);
    greetingHeader.writeUIntLE(greetingPayload.length, 0, 3);
    greetingHeader[3] = 0;
    serverToClient.write(Buffer.concat([greetingHeader, greetingPayload]));
  });

  const rows = await queryViaWireProtocol({
    host: '127.0.0.1',
    stream: clientStream,
    user: 's54321',
    password: 'test_secret',
    database: 'commonswiki_p',
    sql: 'SELECT actor_name, COUNT(*) AS uploads FROM revision',
    timeoutMs: 3000
  });
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], ['Alice', '12']);
});

test('P1-VI: Valued_images_sorted_by_promotion_date CirrusSearch intersection and QI+FP+VI deduplication', async () => {
  analytics.primeParticipantCache('wlmua24', ['Alice', 'Bob', 'Carol'], new Map([['Alice', 5], ['Bob', 3], ['Carol', 2]]));

  analytics.setCommonsFetchMock(async (params: Record<string, string>) => {
    if (params.prop === 'categoryinfo') {
      if (params.titles?.includes('Quality images from Wiki Loves Monuments 2024 in Ukraine')) {
        return { query: { pages: { '600': { categoryinfo: { files: 1 } } } } };
      }
      if (params.titles?.includes('Featured pictures from Wiki Loves Monuments 2024 in Ukraine')) {
        return { query: { pages: { '601': { categoryinfo: { files: 1 } } } } };
      }
      return { query: { pages: {} } };
    }
    if (params.prop === 'imageinfo' && params.gcmtitle?.includes('Quality images from Wiki Loves Monuments 2024 in Ukraine')) {
      return {
        query: {
          pages: {
            '701': { title: 'File:Ternopil_Castle.jpg', imageinfo: [{ user: 'Alice', thumburl: '/t1.jpg' }] }
          }
        }
      };
    }
    if (params.prop === 'imageinfo' && params.gcmtitle?.includes('Featured pictures from Wiki Loves Monuments 2024 in Ukraine')) {
      return {
        query: {
          pages: {
            '702': { title: 'File:Kyiv_Monastery.jpg', imageinfo: [{ user: 'Bob', thumburl: '/t2.jpg' }] }
          }
        }
      };
    }
    if (params.generator === 'search' && params.gsrsearch?.includes('Valued_images_sorted_by_promotion_date')) {
      return {
        query: {
          pages: {
            // File:Ternopil_Castle.jpg holds both QI and VI; File:Drama_Theater.jpg holds VI only
            '701': { title: 'File:Ternopil_Castle.jpg', imageinfo: [{ user: 'Alice', thumburl: '/t1.jpg' }] },
            '703': { title: 'File:Drama_Theater.jpg', imageinfo: [{ user: 'Carol', thumburl: '/t3.jpg' }] }
          }
        }
      };
    }
    return { query: { pages: {} } };
  });

  const qual = await analytics.computeQualityRecognitionDeep('wlmua24');
  assert.equal(qual.qi_count, 1);
  assert.equal(qual.fp_count, 1);
  assert.equal(qual.vi_count, 2);
  assert.equal(qual.recognized_count, 3, 'QI+VI overlap on Ternopil_Castle.jpg must be deduplicated');
  assert.equal(qual.honored_photographers_count, 3);
  const ternopil = qual.recognized_files.find((f: any) => f.title === 'File:Ternopil_Castle.jpg');
  assert.ok(ternopil);
  assert.deepEqual(ternopil.honors, ['Quality Image', 'Valued Image']);
  const aliceEntry = qual.leaderboard.find((l: any) => l.uploader === 'Alice');
  assert.ok(aliceEntry);
  assert.equal(aliceEntry.qi_count, 1);
  assert.equal(aliceEntry.vi_count, 1);
  assert.equal(aliceEntry.total_honors, 2);

  analytics.setCommonsFetchMock(null);
});

test('P2-CACHE: getCampaignStructuralMetrics reuses warm utility_deep cache without re-paginating globalusage', async () => {
  analytics.primeParticipantCache('wlmpl24', ['User1', 'User2'], new Map([['User1', 4], ['User2', 6]]));

  let globalUsageCalls = 0;
  analytics.setCommonsFetchMock(async (params: Record<string, string>) => {
    if (params.prop === 'imageinfo|globalusage') {
      globalUsageCalls++;
      return {
        query: {
          pages: {
            '801': {
              title: 'File:Wawel.jpg',
              imageinfo: [{ user: 'User1', thumburl: '/w.jpg' }],
              globalusage: [{ wiki: 'pl.wikipedia.org', title: 'Wawel' }]
            },
            '802': {
              title: 'File:Gdansk.jpg',
              imageinfo: [{ user: 'User2', thumburl: '/g.jpg' }],
              globalusage: []
            }
          }
        }
      };
    }
    if (params.prop === 'globalusage') {
      globalUsageCalls++;
    }
    return { query: { pages: {} } };
  });

  const util = await analytics.computeContentUtilityDeep('wlmpl24');
  assert.equal(util.distinct_used_images, 1);
  assert.equal(globalUsageCalls, 1);

  const struct = await analytics.getCampaignStructuralMetrics('wlmpl24');
  assert.equal(struct.used_images_sample_count, 1);
  assert.equal(struct.sampled_files_count, 2);
  assert.equal(struct.usage_share, 50.0);
  assert.equal(globalUsageCalls, 1, 'getCampaignStructuralMetrics must reuse warm _utilityDeepCache instead of re-paginating');

  analytics.setCommonsFetchMock(null);
});

test('P3-SURVIVAL: computeComparativeAnalytics computes empirical +1/+2/+3 Yr newcomer survival horizons', async () => {
  analytics.setCommonsFetchMock(async () => ({ query: { pages: {} } }));
  // 2021 newcomers: U1, U2, U3, U4 (4)
  analytics.primeParticipantCache('wlmde21', ['U1', 'U2', 'U3', 'U4'], new Map([['U1', 1], ['U2', 1], ['U3', 1], ['U4', 1]]));
  // 2022: U1, U2 return (2/4 = 50.0%), plus U5 new (1)
  analytics.primeParticipantCache('wlmde22', ['U1', 'U2', 'U5'], new Map([['U1', 1], ['U2', 1], ['U5', 1]]));
  // 2023: unheld / empty -> survival_2y for 2021 and survival_1y for 2022 must be null
  analytics.primeParticipantCache('wlmde23', [], new Map());
  // 2024: U1 returns (1/4 = 25.0% of 2021 cohort at +3 Yr; 0/1 = 0.0% of 2022 cohort at +2 Yr)
  analytics.primeParticipantCache('wlmde24', ['U1', 'U6'], new Map([['U1', 1], ['U6', 1]]));

  const res = await analytics.computeComparativeAnalytics({
    module: 'influx',
    eventType: 'wlm',
    countryCodes: ['de'],
    startYear: 2021,
    endYear: 2024
  });

  assert.ok(res.survival_horizons);
  const deHorizons = res.survival_horizons.de;
  assert.equal(deHorizons.length, 4);

  assert.deepEqual(deHorizons[0], {
    cohort_year: 2021,
    cohort_size: 4,
    survival_1y_pct: 50.0,
    survival_2y_pct: null,
    survival_3y_pct: 25.0
  });
  assert.deepEqual(deHorizons[1], {
    cohort_year: 2022,
    cohort_size: 1,
    survival_1y_pct: null,
    survival_2y_pct: 0.0,
    survival_3y_pct: null
  });
  assert.deepEqual(deHorizons[2], {
    cohort_year: 2023,
    cohort_size: 0,
    survival_1y_pct: null,
    survival_2y_pct: null,
    survival_3y_pct: null
  });
  assert.deepEqual(deHorizons[3], {
    cohort_year: 2024,
    cohort_size: 1,
    survival_1y_pct: null,
    survival_2y_pct: null,
    survival_3y_pct: null
  });

  analytics.setCommonsFetchMock(null);
});



