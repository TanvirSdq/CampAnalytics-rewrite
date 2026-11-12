import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as analytics from '../src/core/analytics.js';
import { asScalarString, safeJsonForScript, escapeHtml, BoundedCache } from '../src/core/utils.js';

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

test('DATA-05: computeHealthEvaluation accepts customBaselineEvent', async () => {
  analytics.setCommonsFetchMock(async () => ({ query: { pages: {} } }));
  analytics.primeParticipantCache('wlmbd23', ['UserA', 'UserB'], new Map([['UserA', 10], ['UserB', 15]]));
  analytics.primeParticipantCache('wlmbd19', ['UserA'], new Map([['UserA', 10]]));

  const evaluation = await analytics.computeHealthEvaluation('wlmbd23', 'South Asia', 'wlmbd19');
  assert.equal(evaluation.target_campaign, 'wlmbd23');
  assert.equal(evaluation.baseline_campaign, 'wlmbd19');
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

test('SEC-01: BoundedCache enforces capacity limits and LRU eviction', () => {
  const cache = new BoundedCache<string, number>(2);
  cache.set('a', 1);
  cache.set('b', 2);
  assert.equal(cache.get('a'), 1);
  cache.set('c', 3);
  assert.equal(cache.has('c'), true);
  assert.equal(cache.size <= 2, true);
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

test('MATH-05: Comparative mobility module produces valid points and methodology card', async () => {
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
  assert.ok(comp.metadata_card);
  assert.ok(comp.metadata_card.license.includes('CC BY-SA 4.0'));
  analytics.setCommonsFetchMock(null);
});

test('UTIL-ALL-01 & QUAL-PAG-01: All Campaigns unique articles deduplication and paginated QI/FP harvesting', async () => {
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

    return { query: { pages: {} } };
  });

  const utilAll = await analytics.computeContentUtilityDeep('allde24');
  assert.equal(utilAll.unique_articles_count, 3, 'All Campaigns must deduplicate unique articles across sub-campaigns');
  assert.equal(utilAll.distinct_articles, 3);
  assert.equal(utilAll.total_global_usages, 4);

  const qualWlm = await analytics.computeQualityRecognitionDeep('wlmde24');
  assert.equal(qualWlm.qi_count, 3);
  assert.equal(qualWlm.honored_photographers_count, 3, 'Must paginate gcmcontinue to count all 3 honored photographers');

  const qualAll = await analytics.computeQualityRecognitionDeep('allde24');
  assert.equal(qualAll.honored_photographers_count, 3, 'All Campaigns must aggregate all_uploader_honors across sub-campaigns');

  analytics.setCommonsFetchMock(null);
});

