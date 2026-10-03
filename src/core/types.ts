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
