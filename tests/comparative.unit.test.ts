import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeComparativeAnalytics, CODEX_COLOR_PALETTE } from '../src/core/analytics.js';
import type {
  ComparativeAnalyticsResult,
  CountrySeries,
  ComparativeTableRow,
  MapTimelinePoint,
  IndicatorMetadata
} from '../src/core/types.js';

describe('Comparative Analytics Engine: Codex Color Palette', () => {
  it('defines a standardized Wikimedia Codex step palette with at least 15 colors', () => {
    assert.ok(Array.isArray(CODEX_COLOR_PALETTE), 'CODEX_COLOR_PALETTE must be an array');
    assert.ok(
      CODEX_COLOR_PALETTE.length >= 15,
      `CODEX_COLOR_PALETTE should have at least 15 steps (got ${CODEX_COLOR_PALETTE.length})`
    );
  });

  it('contains only valid 6-character solid hex color codes', () => {
    const HEX_REGEX = /^#[0-9a-fA-F]{6}$/;
    for (const color of CODEX_COLOR_PALETTE) {
      assert.match(color, HEX_REGEX, `Color "${color}" must be a valid 6-char hex code`);
    }
  });

  it('guarantees 100% unique colors with zero duplicate steps', () => {
    const uniqueColors = new Set(CODEX_COLOR_PALETTE);
    assert.equal(
      uniqueColors.size,
      CODEX_COLOR_PALETTE.length,
      'Every color in CODEX_COLOR_PALETTE must be strictly unique'
    );
  });

  it('verifies primary Wikimedia Codex base colors are represented', () => {
    // Primary Progressive Blue (#3366cc), Destructive (#d73333 or #b32424), Success (#00af89 or #107e3e)
    const normalized = CODEX_COLOR_PALETTE.map((c) => c.toLowerCase());
    assert.ok(
      normalized.includes('#3366cc'),
      'Must include Codex Progressive Blue (#3366cc)'
    );
  });
});

describe('Comparative Analytics Engine: Influx Module', () => {
  it('computes multi-country longitudinal series for Influx', async () => {
    const result: ComparativeAnalyticsResult = await computeComparativeAnalytics({
      module: 'influx',
      eventType: 'wlm',
      countryCodes: ['de', 'it', 'bd'],
      startYear: 2020,
      endYear: 2024
    });

    assert.equal(result.module, 'influx');
    assert.equal(result.event_type, 'wlm');
    assert.deepEqual(result.years, [2020, 2021, 2022, 2023, 2024]);
    assert.equal(result.series.length, 3, 'Should generate a series for each country');

    // Verify country mapping
    const seriesCodes = result.series.map((s) => s.country_code);
    assert.deepEqual(seriesCodes, ['de', 'it', 'bd']);

    // Check Germany series
    const deSeries = result.series.find((s) => s.country_code === 'de');
    assert.ok(deSeries, 'Germany series must exist');
    assert.equal(deSeries.country_name, 'Germany');
    assert.equal(deSeries.points.length, 5, 'Must have 5 year points (2020-2024)');

    for (const pt of deSeries.points) {
      assert.ok(pt.year >= 2020 && pt.year <= 2024);
      assert.ok(typeof pt.value === 'number' || pt.value === null);
      assert.ok(typeof pt.formatted_value === 'string');
      assert.ok(pt.code.startsWith('wlmde'));
    }

    // Verify unique color assignment
    const colors = result.series.map((s) => s.color);
    assert.equal(new Set(colors).size, 3, 'Each country must receive a unique color');
    assert.equal(colors[0], CODEX_COLOR_PALETTE[0]);
    assert.equal(colors[1], CODEX_COLOR_PALETTE[1]);
    assert.equal(colors[2], CODEX_COLOR_PALETTE[2]);
  });
});

describe('Comparative Analytics Engine: Retention Module', () => {
  it('computes multi-country YoY retention percentages', async () => {
    const result = await computeComparativeAnalytics({
      module: 'retention',
      eventType: 'wlm',
      countryCodes: ['de', 'it'],
      startYear: 2021,
      endYear: 2024
    });

    assert.equal(result.module, 'retention');
    assert.equal(result.indicator_unit, '%');
    assert.equal(result.series.length, 2);

    for (const series of result.series) {
      for (const pt of series.points) {
        if (pt.value !== null) {
          assert.ok(
            pt.value >= 0 && pt.value <= 100,
            `Retention rate should be in [0, 100], got ${pt.value}`
          );
          assert.ok(
            pt.formatted_value.includes('%'),
            `Formatted value should contain %, got "${pt.formatted_value}"`
          );
        }
      }
    }
  });
});

describe('Comparative Analytics Engine: Quality Recognition Module', () => {
  it('computes multi-country honors metrics for Quality', async () => {
    const result = await computeComparativeAnalytics({
      module: 'quality',
      eventType: 'wlm',
      countryCodes: ['de', 'it', 'fr'],
      startYear: 2022,
      endYear: 2024
    });

    assert.equal(result.module, 'quality');
    assert.equal(result.series.length, 3);
    assert.ok(result.indicator_id.length > 0);
    assert.ok(result.indicator_title.length > 0);

    for (const series of result.series) {
      assert.equal(series.points.length, 3);
      for (const pt of series.points) {
        if (pt.value !== null) {
          assert.ok(typeof pt.value === 'number');
          assert.ok(pt.value >= 0);
        }
      }
    }
  });
});

describe('Comparative Analytics Engine: Content Utility Module', () => {
  it('computes multi-country global transclusion metrics for Utility', async () => {
    const result = await computeComparativeAnalytics({
      module: 'utility',
      eventType: 'wlm',
      countryCodes: ['de', 'it'],
      startYear: 2022,
      endYear: 2024
    });

    assert.equal(result.module, 'utility');
    assert.equal(result.series.length, 2);
    assert.ok(result.indicator_id.length > 0);

    for (const series of result.series) {
      for (const pt of series.points) {
        if (pt.value !== null) {
          assert.ok(typeof pt.value === 'number');
          assert.ok(pt.value >= 0);
        }
      }
    }
  });

  it('supports all rate metricKey aliases for Utility (utility_rate, utility_rate_pct, global_utility_rate, global_utility_rate_pct)', async () => {
    const rateKeys = ['utility_rate', 'utility_rate_pct', 'global_utility_rate', 'global_utility_rate_pct'];
    for (const key of rateKeys) {
      const result = await computeComparativeAnalytics({
        module: 'utility',
        eventType: 'wlm',
        countryCodes: ['de'],
        startYear: 2022,
        endYear: 2024,
        metricKey: key
      });
      assert.equal(result.indicator_id, 'utility_rate', `Failed indicator_id for ${key}`);
      assert.equal(result.indicator_title, 'Global Content Utility Rate');
      assert.equal(result.indicator_unit, '%');
      assert.ok(result.series[0].points[0].formatted_value.endsWith('%'));
    }
  });

  it('safely defaults to utility_global_usages when metricKey is omitted or raw count is requested', async () => {
    for (const key of [undefined, 'utility_global_usages', 'total_global_usages']) {
      const result = await computeComparativeAnalytics({
        module: 'utility',
        eventType: 'wlm',
        countryCodes: ['de'],
        startYear: 2022,
        endYear: 2024,
        metricKey: key
      });
      assert.equal(result.indicator_id, 'utility_global_usages');
      assert.equal(result.indicator_title, 'Global Article Transclusion & Content Usages');
      assert.equal(result.indicator_unit, 'Article Usages');
    }
  });
});

describe('Comparative Analytics Engine: Summary Statistics & Calculations', () => {
  it('calculates mathematically coherent summary statistics for series', async () => {
    const result = await computeComparativeAnalytics({
      module: 'influx',
      eventType: 'wlm',
      countryCodes: ['de'],
      startYear: 2020,
      endYear: 2024
    });

    const series = result.series[0];
    assert.ok(series, 'Series must exist');
    const { summary } = series;

    assert.equal(summary.latest_year, 2024);
    assert.ok(typeof summary.latest_value === 'number');
    assert.ok(typeof summary.min_value === 'number');
    assert.ok(typeof summary.max_value === 'number');
    assert.ok(typeof summary.avg_value === 'number');

    // Mathematical inequality: min <= avg <= max
    assert.ok(
      summary.min_value <= summary.avg_value,
      `min (${summary.min_value}) must be <= avg (${summary.avg_value})`
    );
    assert.ok(
      summary.avg_value <= summary.max_value,
      `avg (${summary.avg_value}) must be <= max (${summary.max_value})`
    );

    // Latest value equals 2024 point
    const pt2024 = series.points.find((p) => p.year === 2024);
    if (pt2024 && pt2024.value !== null) {
      assert.equal(summary.latest_value, pt2024.value);
    }

    // YoY change verification
    if (summary.yoy_change_pct !== null) {
      const pt2023 = series.points.find((p) => p.year === 2023);
      if (pt2023 && pt2023.value && pt2024 && pt2024.value) {
        const expectedYoy = parseFloat(
          (((pt2024.value - pt2023.value) / pt2023.value) * 100).toFixed(1)
        );
        assert.ok(
          Math.abs(summary.yoy_change_pct - expectedYoy) <= 0.2,
          `YoY change calculation discrepancy: got ${summary.yoy_change_pct}, expected ${expectedYoy}`
        );
      }
    }
  });
});

describe('Comparative Analytics Engine: Cross-Sectional Table Structure', () => {
  it('generates properly formatted table headers and rows', async () => {
    const result = await computeComparativeAnalytics({
      module: 'influx',
      eventType: 'wlm',
      countryCodes: ['de', 'it'],
      startYear: 2022,
      endYear: 2024
    });

    const { table_data } = result;
    assert.ok(table_data, 'table_data must exist');
    assert.ok(Array.isArray(table_data.headers), 'headers must be an array');
    assert.ok(table_data.headers.includes('Country'));
    assert.ok(table_data.headers.includes('2022'));
    assert.ok(table_data.headers.includes('2023'));
    assert.ok(table_data.headers.includes('2024'));
    assert.ok(table_data.headers.includes('Latest'));
    assert.ok(table_data.headers.includes('Average'));
    assert.ok(table_data.headers.includes('YoY Change'));

    assert.equal(table_data.rows.length, 2);
    for (const row of table_data.rows) {
      assert.ok(['de', 'it'].includes(row.country_code));
      assert.ok(typeof row.country_name === 'string');
      assert.ok('2022' in row.values || 2022 in row.values);
      assert.ok('2024' in row.values || 2024 in row.values);
      assert.ok(row.formatted_values);
    }
  });
});

describe('Comparative Analytics Engine: Map Timeline Data Structure', () => {
  it('generates year-indexed map timeline points for scrubber playback', async () => {
    const result = await computeComparativeAnalytics({
      module: 'influx',
      eventType: 'wlm',
      countryCodes: ['de', 'it', 'bd'],
      startYear: 2021,
      endYear: 2023
    });

    const { map_timeline_data } = result;
    assert.ok(map_timeline_data, 'map_timeline_data must exist');

    for (const yr of [2021, 2022, 2023]) {
      const yearPoints = map_timeline_data[yr];
      assert.ok(Array.isArray(yearPoints), `Timeline points for year ${yr} must be an array`);
      assert.equal(yearPoints.length, 3, `Must contain points for all 3 countries in year ${yr}`);

      for (const pt of yearPoints) {
        assert.ok(['de', 'it', 'bd'].includes(pt.country_code));
        assert.ok(typeof pt.country_name === 'string');
        assert.ok(typeof pt.value === 'number');
        assert.ok(typeof pt.formatted_value === 'string');
      }
    }
  });
});

describe('Comparative Analytics Engine: Indicator Metadata Card', () => {
  it('includes complete CC BY-SA 4.0 indicator metadata with methodology notes', async () => {
    const result = await computeComparativeAnalytics({
      module: 'influx',
      eventType: 'wlm',
      countryCodes: ['de'],
      startYear: 2022,
      endYear: 2024
    });

    const { metadata_card } = result;
    assert.ok(metadata_card, 'metadata_card must exist');
    assert.ok(metadata_card.indicator_id.length > 0);
    assert.ok(metadata_card.title.length > 0);
    assert.ok(metadata_card.definition.length > 0);
    assert.ok(metadata_card.data_source.length > 0);
    assert.ok(metadata_card.metric_unit.length > 0);
    assert.ok(metadata_card.coverage.length > 0);
    assert.equal(metadata_card.license, 'CC BY-SA 4.0');
    assert.ok(Array.isArray(metadata_card.methodology_notes));
    assert.ok(metadata_card.methodology_notes.length >= 1);
  });
});

describe('Comparative Analytics Engine: Edge Cases & Robustness', () => {
  it('handles campaign regional scope restrictions (Wiki Loves Africa wla)', async () => {
    // Nigeria (ng) is African scope; Germany (de) is NOT in wla scope
    const result = await computeComparativeAnalytics({
      module: 'influx',
      eventType: 'wla',
      countryCodes: ['ng', 'de'],
      startYear: 2022,
      endYear: 2024
    });

    assert.ok(result, 'Must handle wla campaign without throwing');
    assert.equal(result.module, 'influx');
    // The engine should either gracefully omit out-of-scope countries or return empty/null series for them
    const ngSeries = result.series.find((s) => s.country_code === 'ng');
    assert.ok(ngSeries, 'Nigeria should be present in wla series');
  });

  it('handles Wiki Loves Bangla (wlb) regional scope', async () => {
    // Bangladesh (bd) and India (in) are in wlb scope; United States (us) is NOT
    const result = await computeComparativeAnalytics({
      module: 'influx',
      eventType: 'wlb',
      countryCodes: ['bd', 'us'],
      startYear: 2022,
      endYear: 2024
    });

    assert.ok(result, 'Must handle wlb campaign without throwing');
    const bdSeries = result.series.find((s) => s.country_code === 'bd');
    assert.ok(bdSeries, 'Bangladesh should be present in wlb series');
  });

  it('handles empty country codes array gracefully with sensible fallback defaults', async () => {
    const result = await computeComparativeAnalytics({
      module: 'influx',
      eventType: 'wlm',
      countryCodes: [],
      startYear: 2022,
      endYear: 2024
    });

    assert.ok(result, 'Must return valid result object');
    assert.ok(result.series.length > 0, 'Should fall back to default countries when none specified');
    assert.equal(result.table_data.rows.length, result.series.length);
    assert.ok(result.metadata_card);
  });

  it('handles year parameter boundary clamping (e.g. startYear > endYear)', async () => {
    const result = await computeComparativeAnalytics({
      module: 'influx',
      eventType: 'wlm',
      countryCodes: ['de'],
      startYear: 2024,
      endYear: 2020 // inverted bounds
    });

    assert.ok(result.years.length > 0);
    // Years must be sorted in ascending order
    for (let i = 1; i < result.years.length; i++) {
      assert.ok(
        result.years[i] > result.years[i - 1],
        `Years must be ascending: ${result.years}`
      );
    }
  });

  it('correctly cycles through Codex palette when country count exceeds palette length', async () => {
    // Request 18 valid countries from COUNTRY_MAP (exceeds 15 palette colors)
    const countries18 = [
      'de', 'it', 'fr', 'es', 'nl', 'pl', 'se', 'no', 'fi', 'hu',
      'be', 'at', 'ch', 'pt', 'gr', 'ua', 'cz', 'ro'
    ];

    const result = await computeComparativeAnalytics({
      module: 'influx',
      eventType: 'wlm',
      countryCodes: countries18,
      startYear: 2023,
      endYear: 2024
    });

    assert.equal(result.series.length, 18);
    // 16th country (index 15) wraps to palette[0]
    assert.equal(result.series[15].color, CODEX_COLOR_PALETTE[0]);
    assert.equal(result.series[16].color, CODEX_COLOR_PALETTE[1]);
    assert.equal(result.series[17].color, CODEX_COLOR_PALETTE[2]);
  });

  it('filters null, undefined, and non-string elements from countryCodes without throwing', async () => {
    const result = await computeComparativeAnalytics({
      module: 'influx',
      eventType: 'wlm',
      countryCodes: [null as any, undefined as any, 42 as any, '  de  ', 'it', ''] as any,
      startYear: 2022,
      endYear: 2024
    });

    assert.ok(result, 'Must handle mixed null/undefined/non-string countryCodes');
    assert.deepEqual(result.selected_countries, ['de', 'it']);
    assert.equal(result.series.length, 2);
    assert.equal(result.series[0].country_code, 'de');
    assert.equal(result.series[1].country_code, 'it');
  });

  it('handles countryCodes passed as a single string instead of an array', async () => {
    const result = await computeComparativeAnalytics({
      module: 'influx',
      eventType: 'wlm',
      countryCodes: 'de' as any,
      startYear: 2022,
      endYear: 2024
    });

    assert.ok(result, 'Must handle single string countryCodes without throwing');
    assert.deepEqual(result.selected_countries, ['de']);
    assert.equal(result.series.length, 1);
    assert.equal(result.series[0].country_code, 'de');
  });
});
