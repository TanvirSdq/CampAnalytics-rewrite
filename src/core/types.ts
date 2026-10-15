import { Request } from 'express';

export interface GlobalContext {
  PAGE_TITLE: string;
  PAGE_ICON: string;
  KORIKATH_LOGO_URL: string;
  EVENT_MAP: Record<string, string>;
  EVENT_DISPLAY_MAP: Record<string, string>;
  EVENT_COUNTRY_SCOPE: Record<string, any>;
  COUNTRY_OPTIONS: string[];
  COUNTRY_MAP: Record<string, string>;
  REGION_COUNTRY_MAPPING: Record<string, string[]>;
  COUNTRY_TO_REGION: Record<string, string>;
  EXAMPLE_CODES: string;
  CUSTOM_CSS: string;
  TEXT_MUTED: string;
  CURRENT_YEAR: number;
  DEFAULT_START_YEAR: number;
  ASSET_VERSION?: string;
  request: {
    path: string;
    query: Record<string, any>;
  };
}

export interface HealthBenchmarks {
  retention: number;
  growth: number;
  quality: number;
  diversity: number;
  usage: number;
}

export interface HealthMetricDimension {
  raw: number;
  score: number;
  weight: number;
  benchmark: number;
  stars: [string, number];
}

export interface HealthMetrics {
  composite_score: number;
  tier: string;
  stars: [string, number];
  dimensions: {
    retention: HealthMetricDimension;
    growth: HealthMetricDimension;
    quality: HealthMetricDimension;
    diversity: HealthMetricDimension;
    usage: HealthMetricDimension;
  };
}

export interface HealthEvaluationResult {
  target_campaign: string;
  baseline_campaign: string;
  region: string;
  target_users_count: number;
  baseline_users_count: number;
  overlap_users_count: number;
  composite_score: number;
  tier: string;
  stars: [string, number];
  dimensions: any;
  benchmarks: HealthBenchmarks;
  insights: string[];
}

export interface InfluxRecord {
  year: number;
  code: string;
  total_active: number;
  new_users: number;
  returning_users: number;
  new_user_share: number;
  yoy_growth: number;
}

export interface InfluxResult {
  campaign_codes?: string[];
  records: InfluxRecord[];
  lifecycle?: any;
  summary?: any;
}

export interface HeatmapItem {
  country_code: string;
  country_title: string;
  heatmap_b64: string;
}

export interface HeatmapsApiResponse {
  heatmaps: HeatmapItem[];
  offset: number;
  limit: number;
  total_count: number;
  has_more: boolean;
  remaining_count: number;
}

export interface TimeSeriesPoint {
  year: number;
  value: number | null;
  formatted_value: string;
  code: string;
  is_baseline?: boolean;
}

export interface CountrySeries {
  country_code: string;
  country_name: string;
  color: string;
  points: TimeSeriesPoint[];
  summary: {
    latest_year: number;
    latest_value: number;
    min_value: number;
    max_value: number;
    avg_value: number;
    yoy_change_pct: number | null;
  };
}

export interface ComparativeTableRow {
  country_code: string;
  country_name: string;
  values: Record<number, number | null>;
  formatted_values: Record<number, string>;
  latest: number | null;
  average: number | null;
  yoy_change: number | null;
}

export interface MapTimelinePoint {
  country_code: string;
  country_name: string;
  value: number;
  formatted_value: string;
}

export interface IndicatorMetadata {
  indicator_id: string;
  title: string;
  definition: string;
  data_source: string;
  metric_unit: string;
  coverage: string;
  license: string;
  methodology_notes: string[];
  caveats: string[];
}

export interface ComparativeAnalyticsResult {
  module: 'influx' | 'retention' | 'quality' | 'utility' | 'mobility' | 'diversity';
  indicator_id: string;
  indicator_title: string;
  indicator_unit: string;
  event_type: string;
  event_name: string;
  years: number[];
  selected_countries: string[];
  series: CountrySeries[];
  table_data: {
    headers: string[];
    rows: ComparativeTableRow[];
  };
  map_timeline_data: Record<number, MapTimelinePoint[]>;
  metadata_card: IndicatorMetadata;
}

export interface ComparativeParams {
  module: 'influx' | 'retention' | 'quality' | 'utility' | 'mobility' | 'diversity';
  eventType: string;
  countryCodes: string[];
  startYear: number;
  endYear: number;
  metricKey?: string;
}

// =========================================================================
// MOBILITY (TOOL 04) TYPES
// =========================================================================

export interface MobilityMatrixCell {
  source_event: string;
  source_name: string;
  target_event: string;
  target_name: string;
  source_users_count: number;
  target_users_count: number;
  overlap_count: number;
  conversion_rate: number; // |A ∩ B| / |A| * 100%
  jaccard_similarity: number; // |A ∩ B| / |A ∪ B| * 100%
}

export interface MobilityMatrixRow {
  source_event: string;
  source_name: string;
  source_users_count: number;
  cells: MobilityMatrixCell[];
}

export interface MobilityResult {
  year: number;
  country_code: string;
  country_name: string;
  events: string[];
  event_names: Record<string, string>;
  event_user_counts: Record<string, number>;
  total_unique_ecosystem_users: number;
  matrix: MobilityMatrixRow[];
  summary: {
    highest_conversion: { source: string; target: string; rate: number } | null;
    highest_overlap: { source: string; target: string; count: number } | null;
    average_conversion: number;
  };
  metadata_card: IndicatorMetadata;
}

// =========================================================================
// DIVERSITY (TOOL 05) TYPES
// =========================================================================

export interface ContributorTierBreakdown {
  casual_count: number;      // 1-4 uploads
  casual_share: number;
  regular_count: number;     // 5-24 uploads
  regular_share: number;
  active_count: number;      // 25-99 uploads
  active_share: number;
  power_count: number;       // 100+ uploads
  power_share: number;
}

export interface DiversityRecord {
  year: number;
  code: string;
  country_code: string;
  country_name: string;
  total_users: number;
  total_uploads: number;
  gini_coefficient: number;
  top_10_percent_share: number;
  top_20_percent_share: number;
  tiers: ContributorTierBreakdown;
  percentile_shares: number[];
  lorenz_curve?: { p: number; l: number }[];
}

export interface DiversityResult {
  event_type: string;
  event_name: string;
  country_code: string;
  country_name: string;
  start_year: number;
  end_year: number;
  records: DiversityRecord[];
  summary: {
    average_gini: number;
    latest_gini: number;
    average_top_10_share: number;
    latest_top_10_share: number;
  };
  metadata_card: IndicatorMetadata;
}


