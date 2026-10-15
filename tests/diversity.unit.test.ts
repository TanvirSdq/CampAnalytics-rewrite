import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeDiversityAnalytics,
  computeSingleDiversityRecord,
  computeComparativeAnalytics
} from '../src/core/analytics.js';
import type { DiversityResult, DiversityRecord } from '../src/core/types.js';

describe('Contributor Diversity Analytics Engine', () => {
  it('computes longitudinal diversity records and tiers for Germany WLM', async () => {
    const result: DiversityResult = await computeDiversityAnalytics({
      eventType: 'wlm',
      countryCode: 'de',
      startYear: 2020,
      endYear: 2024
    });

    assert.equal(result.event_type, 'wlm');
    assert.equal(result.country_code, 'de');
    assert.equal(result.country_name, 'Germany');
    assert.equal(result.start_year, 2020);
    assert.equal(result.end_year, 2024);
    assert.equal(result.records.length, 5, 'Should have 5 annual edition records');

    for (const rec of result.records) {
      assert.ok(rec.total_users > 0, 'Should have active contributors');
      assert.ok(rec.total_uploads > 0, 'Should have total uploads');

      // Gini coefficient strictly bounded in [0, 1]
      assert.ok(
        rec.gini_coefficient >= 0 && rec.gini_coefficient <= 1,
        `Gini (${rec.gini_coefficient}) must be between 0 and 1`
      );

      // Top 10% and 20% shares strictly bounded in [0, 100]
      assert.ok(
        rec.top_10_percent_share >= 0 && rec.top_10_percent_share <= 100,
        `Top 10% share (${rec.top_10_percent_share}) must be between 0 and 100%`
      );
      assert.ok(
        rec.top_20_percent_share >= rec.top_10_percent_share,
        `Top 20% share (${rec.top_20_percent_share}) must be >= top 10% share (${rec.top_10_percent_share})`
      );

      // Verify 4-tier consistency
      const totalTierUsers =
        rec.tiers.casual_count +
        rec.tiers.regular_count +
        rec.tiers.active_count +
        rec.tiers.power_count;
      assert.equal(totalTierUsers, rec.total_users, 'Sum of volume tiers must equal total contributors');

      const totalTierShare =
        rec.tiers.casual_share +
        rec.tiers.regular_share +
        rec.tiers.active_share +
        rec.tiers.power_share;
      assert.ok(
        Math.abs(totalTierShare - 100) <= 0.5,
        `Sum of tier shares (${totalTierShare}%) should be ~100%`
      );
    }
  });

  it('computes coherent summary statistics without made-up baselines', async () => {
    const result: DiversityResult = await computeDiversityAnalytics({
      eventType: 'wlm',
      countryCode: 'it',
      startYear: 2021,
      endYear: 2023
    });

    assert.ok(result.summary, 'Summary must exist');
    assert.ok(typeof result.summary.average_gini === 'number');
    assert.ok(typeof result.summary.latest_gini === 'number');
    assert.ok(typeof result.summary.average_top_10_share === 'number');
    assert.ok(typeof result.summary.latest_top_10_share === 'number');

    assert.ok(result.summary.average_gini >= 0 && result.summary.average_gini <= 1);
    assert.ok(result.summary.latest_gini >= 0 && result.summary.latest_gini <= 1);
    assert.ok(result.summary.average_top_10_share >= 0 && result.summary.average_top_10_share <= 100);
  });

  it('verifies Indicator Metadata Card conforms to CC BY-SA 4.0 specifications', async () => {
    const result: DiversityResult = await computeDiversityAnalytics({
      eventType: 'wlm',
      countryCode: 'de'
    });

    assert.ok(result.metadata_card, 'Metadata card must exist');
    assert.equal(result.metadata_card.indicator_id, 'diversity_gini');
    assert.equal(result.metadata_card.license, 'CC BY-SA 4.0');
    assert.ok(result.metadata_card.methodology_notes.length >= 3);
  });

  it('supports comparative diversity analytics across multiple countries', async () => {
    const compResult = await computeComparativeAnalytics({
      module: 'diversity',
      eventType: 'wlm',
      countryCodes: ['de', 'it'],
      startYear: 2022,
      endYear: 2024
    });

    assert.equal(compResult.module, 'diversity');
    assert.equal(compResult.series.length, 2);
    assert.deepEqual(compResult.years, [2022, 2023, 2024]);

    for (const s of compResult.series) {
      assert.equal(s.points.length, 3);
      for (const pt of s.points) {
        assert.ok(pt.value !== null && pt.value >= 0 && pt.value <= 1);
      }
    }
  });
});
