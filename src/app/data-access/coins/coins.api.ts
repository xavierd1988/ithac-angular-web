import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';

import { AlertsApi } from '../alerts/alerts.api';
import { AlertSignal, AlertVerdictDto, TimexPricePoint } from '../alerts/alerts.types';
import { CoinSignalSummary, CoinSparklinePoint } from './coins.types';

@Injectable({ providedIn: 'root' })
export class CoinsApi {
  private readonly alertsApi = inject(AlertsApi);

  listCoins(): Observable<CoinSignalSummary[]> {
    return this.alertsApi.listAlerts().pipe(map(buildCoinSignalSummaries));
  }
}

export function buildCoinSignalSummaries(alerts: AlertSignal[]): CoinSignalSummary[] {
  const grouped = new Map<string, AlertSignal[]>();

  for (const alert of alerts) {
    const key = alert.tokenSymbol.toUpperCase();
    grouped.set(key, [...(grouped.get(key) ?? []), alert]);
  }

  return [...grouped.entries()]
    .map(([symbol, coinAlerts]) => {
      const sorted = [...coinAlerts].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      const latest = sorted[0];
      const performances = sorted.map((alert) => alert.performancePercent);
      const averagePerformancePercent =
        performances.reduce((sum, value) => sum + value, 0) / Math.max(performances.length, 1);

      return {
        id: symbol,
        symbol,
        name: latest.tokenName,
        latestAlertId: latest.id,
        latestAt: latest.createdAt,
        topCaller: latest.callerHandle,
        verdict: strongestVerdict(sorted),
        alertCount: sorted.length,
        mentionCount: sorted.reduce((sum, alert) => sum + alert.mentionCount, 0),
        averagePerformancePercent,
        bestPerformancePercent: Math.max(...performances),
        worstPerformancePercent: Math.min(...performances),
        sparkline: buildSparkline(latest.pricePoints)
      };
    })
    .sort(
      (a, b) =>
        b.alertCount - a.alertCount ||
        b.averagePerformancePercent - a.averagePerformancePercent ||
        new Date(b.latestAt).getTime() - new Date(a.latestAt).getTime()
    );
}

function strongestVerdict(alerts: AlertSignal[]): AlertVerdictDto {
  if (alerts.some((alert) => alert.verdict === 'SUPER TRADE')) {
    return 'SUPER TRADE';
  }

  if (alerts.some((alert) => alert.verdict === 'GOOD TRADE')) {
    return 'GOOD TRADE';
  }

  return 'AVOID';
}

function buildSparkline(points: TimexPricePoint[]): CoinSparklinePoint[] {
  if (points.length === 0) {
    return [];
  }

  const values = points.map((point) => point.changePercent);
  let min = Math.min(...values);
  let max = Math.max(...values);

  if (min === max) {
    min -= 1;
    max += 1;
  }

  return points.map((point) => ({
    label: point.label,
    valuePercent: point.changePercent,
    heightPercent: 18 + ((point.changePercent - min) / (max - min)) * 82
  }));
}
