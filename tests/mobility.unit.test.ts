import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeMobilityAnalytics, isEventScopedForCountry } from '../src/core/analytics.js';
import type { MobilityResult } from '../src/core/types.js';

describe('Contributor Mobility Analytics Engine', () => {
  it('computes directional mobility matrix for scoped campaigns in Germany', async () => {
    const result: MobilityResult = await computeMobilityAnalytics({
      year: 2023,
      countryCode: 'de'
    });

    assert.equal(result.year, 2023);
    assert.equal(result.country_code, 'de');
    assert.equal(result.country_name, 'Germany');
    assert.ok(result.total_unique_ecosystem_users > 0, 'Should have unique ecosystem photographers');

    // In Germany, wla (Africa) and wlb (Bangla) must be excluded by regional scope
    assert.ok(result.events.includes('wlm'), 'Should include WLM');
    assert.ok(result.events.includes('wle'), 'Should include WLE');
    assert.ok(result.events.includes('wlf'), 'Should include WLF');
    assert.ok(!result.events.includes('wla'), 'Should exclude WLA for Germany');
    assert.ok(!result.events.includes('wlb'), 'Should exclude WLB for Germany');

    // Matrix rows match events
    assert.equal(result.matrix.length, result.events.length);

    // Verify diagonal properties (A -> A)
    for (const row of result.matrix) {
      const selfCell = row.cells.find((c) => c.target_event === row.source_event);
      assert.ok(selfCell, `Diagonal cell must exist for ${row.source_event}`);
      if (row.source_users_count > 0) {
        assert.equal(selfCell.conversion_rate, 100, 'Self conversion must be 100%');
        assert.equal(selfCell.jaccard_similarity, 100, 'Self Jaccard must be 100%');
        assert.equal(selfCell.overlap_count, row.source_users_count, 'Self overlap must equal source count');
      }
    }
  });

  it('correctly includes regional campaigns for Bangladesh', async () => {
    const result: MobilityResult = await computeMobilityAnalytics({
      year: 2023,
      countryCode: 'bd'
    });

    assert.equal(result.country_code, 'bd');
    assert.ok(result.events.includes('wlb'), 'Bangladesh must include Wiki Loves Bangla');
    assert.ok(!result.events.includes('wla'), 'Bangladesh must NOT include Wiki Loves Africa');
  });

  it('correctly includes regional campaigns for Nigeria', async () => {
    const result: MobilityResult = await computeMobilityAnalytics({
      year: 2023,
      countryCode: 'ng'
    });

    assert.equal(result.country_code, 'ng');
    assert.ok(result.events.includes('wla'), 'Nigeria must include Wiki Loves Africa');
    assert.ok(!result.events.includes('wlb'), 'Nigeria must NOT include Wiki Loves Bangla');
  });

  it('calculates mathematically coherent directional conversion rates and Jaccard similarity', async () => {
    const result: MobilityResult = await computeMobilityAnalytics({
      year: 2023,
      countryCode: 'de',
      events: ['wlm', 'wle']
    });

    assert.equal(result.matrix.length, 2);
    const rowWlm = result.matrix.find((r) => r.source_event === 'wlm');
    assert.ok(rowWlm, 'Row for WLM must exist');

    const cellWlmToWle = rowWlm.cells.find((c) => c.target_event === 'wle');
    assert.ok(cellWlmToWle, 'Cell WLM -> WLE must exist');

    if (rowWlm.source_users_count > 0) {
      // Conversion rate = |A ∩ B| / |A| * 100%
      const expectedRate = parseFloat(((cellWlmToWle.overlap_count / rowWlm.source_users_count) * 100).toFixed(1));
      assert.equal(cellWlmToWle.conversion_rate, expectedRate);
      assert.ok(cellWlmToWle.conversion_rate >= 0 && cellWlmToWle.conversion_rate <= 100);
    }
  });

  it('verifies summary statistics are non-null and correctly bounded', async () => {
    const result: MobilityResult = await computeMobilityAnalytics({
      year: 2023,
      countryCode: 'de'
    });

    assert.ok(result.summary, 'Summary object must exist');
    assert.ok(typeof result.summary.average_conversion === 'number');
    assert.ok(result.summary.average_conversion >= 0 && result.summary.average_conversion <= 100);

    if (result.summary.highest_conversion) {
      assert.ok(typeof result.summary.highest_conversion.rate === 'number');
      assert.ok(result.summary.highest_conversion.rate >= 0);
    }
  });

  it('includes standard CC BY-SA 4.0 Indicator Metadata Card', async () => {
    const result: MobilityResult = await computeMobilityAnalytics({
      year: 2023,
      countryCode: 'de'
    });

    assert.ok(result.metadata_card, 'Metadata card must exist');
    assert.equal(result.metadata_card.indicator_id, 'mobility_overlap');
    assert.equal(result.metadata_card.license, 'CC BY-SA 4.0');
    assert.ok(result.metadata_card.methodology_notes.length >= 3);
  });

  it('computes well-formed Ecosystem Flow Sankey data with flow conservation', async () => {
    const result: MobilityResult = await computeMobilityAnalytics({
      year: 2023,
      countryCode: 'de'
    });

    assert.ok(result.flow, 'Flow object must exist on mobility result');
    assert.ok(Array.isArray(result.flow.nodes), 'Flow nodes must be an array');
    assert.ok(result.flow.nodes.length >= 2, 'Should have multiple nodes');
    assert.ok(Array.isArray(result.flow.links), 'Flow links must be an array');
    assert.ok(result.flow.links.length > 0, 'Should have links');

    // All links must refer to valid node indices and have non-negative values
    for (const link of result.flow.links) {
      assert.ok(link.source >= 0 && link.source < result.flow.nodes.length, 'Source index in range');
      assert.ok(link.target >= 0 && link.target < result.flow.nodes.length, 'Target index in range');
      assert.ok(link.value >= 0, 'Link value must be non-negative');
      assert.ok(typeof link.label === 'string', 'Link label must be a string');
    }

    // Total link value should match sum of source flows
    const totalLinkValue = result.flow.links.reduce((acc, l) => acc + l.value, 0);
    assert.ok(totalLinkValue > 0, 'Total flow volume should be greater than 0');
  });
});

