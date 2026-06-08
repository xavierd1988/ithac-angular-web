import { AlertVerdictDto } from '../alerts/alerts.types';

export interface CoinSignalSummary {
  id: string;
  symbol: string;
  name: string;
  latestAlertId: string;
  latestAt: string;
  topCaller: string;
  verdict: AlertVerdictDto;
  alertCount: number;
  mentionCount: number;
  averagePerformancePercent: number;
  bestPerformancePercent: number;
  worstPerformancePercent: number;
  sparkline: CoinSparklinePoint[];
}

export interface CoinSparklinePoint {
  label: string;
  valuePercent: number;
  heightPercent: number;
}
