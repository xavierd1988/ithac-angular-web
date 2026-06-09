import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { delay, map, Observable, of, tap, throwError } from 'rxjs';

import { ApiUrlService } from '../../core/api/api-url.service';
import { appEnvironment } from '../../core/config/app-environment';
import type { components } from '../generated/ithac-api.types';
import { MOCK_ALERTS } from './alerts.fixtures';
import { AlertSignal, AlertVerdict, CryptoMentionAlertEventDto } from './alerts.types';

type BackendAlertsEnvelope = components['schemas']['CoinTrendsBackend.Models.AlertsListEnvelopeDto'];
type BackendAlert = components['schemas']['CoinTrendsBackend.Models.AlertItemDto'];
type BackendLiveEnvelope = {
  success?: boolean;
  data?: BackendAlert[] | { data?: BackendAlert[] | null } | null;
};
type BackendTopInfluencer = components['schemas']['CoinTrendsBackend.Models.AlertTopInfluencerDto'];
type BackendRankedInfluencer =
  components['schemas']['CoinTrendsBackend.Models.AlertRankedInfluencerDto'];
type BackendTimexPricePoint =
  components['schemas']['CoinTrendsBackend.Models.AlertTimexPricePointDto'];
type BackendInfluencer = BackendTopInfluencer | BackendRankedInfluencer;
type BackendMentionWithLinks = NonNullable<BackendAlert['consolidatedMentions']>[number] & {
  text?: string | null;
  sourceUrl?: string | null;
};

@Injectable({ providedIn: 'root' })
export class AlertsApi {
  private static readonly liveFeedPageSize = 24;

  private readonly http = inject(HttpClient);
  private readonly apiUrl = inject(ApiUrlService);
  private listCache = new Map<number, AlertSignal[]>();

  listAlerts(options: { forceRefresh?: boolean; pageSize?: number } = {}): Observable<AlertSignal[]> {
    if (appEnvironment.useMockData) {
      return of(MOCK_ALERTS).pipe(delay(180));
    }

    const pageSize = Math.max(1, Math.min(options.pageSize ?? AlertsApi.liveFeedPageSize, 100));
    const cached = this.listCache.get(pageSize);
    if (cached && !options.forceRefresh) {
      return of(cached);
    }

    return this.http
      .get<BackendLiveEnvelope | BackendAlertsEnvelope>(
        this.apiUrl.endpoint(`/api/Alerts?page=1&pageSize=${pageSize}`)
      )
      .pipe(
        map((response) => extractAlertList(response).map(mapBackendAlert)),
        tap((alerts) => {
          this.listCache.set(pageSize, alerts);
        })
      );
  }

  getAlert(alertId: string): Observable<AlertSignal> {
    if (appEnvironment.useMockData) {
      const alert = MOCK_ALERTS.find((item) => item.id === alertId);
      return alert ? of(alert).pipe(delay(120)) : throwError(() => new Error('Alert not found'));
    }

    const cached = [...this.listCache.values()].flat().find((item) => item.id === alertId);
    if (cached) {
      return of(cached);
    }

    return this.http
      .get<BackendAlert>(this.apiUrl.endpoint(`/api/Alerts/${encodeURIComponent(alertId)}`))
      .pipe(map(mapBackendAlert));
  }

  clearCache(): void {
    this.listCache.clear();
  }

  prependCachedAlert(alert: AlertSignal): void {
    const cached = this.listCache.get(AlertsApi.liveFeedPageSize);
    if (!cached) {
      return;
    }

    this.listCache.set(
      AlertsApi.liveFeedPageSize,
      [alert, ...cached.filter((item) => item.id !== alert.id)].slice(0, AlertsApi.liveFeedPageSize)
    );
  }
}

export function coerceLiveAlertEvent(message: unknown): AlertSignal | null {
  if (!message || typeof message !== 'object') {
    return null;
  }

  const maybeEvent = message as Partial<CryptoMentionAlertEventDto> & Record<string, unknown>;
  const candidate = maybeEvent.alert ?? message;

  if (!candidate || typeof candidate !== 'object') {
    return null;
  }

  if (isAlertSignal(candidate)) {
    return candidate;
  }

  if (looksLikeBackendAlert(candidate)) {
    return mapBackendAlert(candidate as BackendAlert);
  }

  return null;
}

function mapBackendAlert(alert: BackendAlert): AlertSignal {
  const leadInfluencer = alert.rankedInfluencers?.[0] ?? alert.topInfluencers?.[0] ?? null;
  const performancePercent = alert.timex?.resultPct ?? 0;
  const callerHandle = leadInfluencer?.username ? `@${leadInfluencer.username}` : '@unknown';
  const callerName = leadInfluencer?.username ?? 'Unknown caller';
  const sourceAlertId = toOptionalString(alert.sourceAlertId);
  const externalAlertId = toOptionalString(alert.alertId);
  const alertId =
    sourceAlertId ?? externalAlertId ?? `${alert.token?.symbol ?? 'alert'}-${alert.timestamp ?? 'unknown'}`;
  const observedAt = alert.detectedAt ?? alert.timestamp ?? '';
  const pricePoints = mapTimexPricePoints(alert.timex?.pricePoints);

  return {
    id: alertId,
    sourceAlertId,
    externalAlertId,
    tokenSymbol: alert.token?.symbol ?? 'N/A',
    tokenName: alert.token?.name ?? alert.token?.symbol ?? 'Unknown token',
    callerName,
    callerHandle,
    verdict: verdictFromPerformance(performancePercent, alert.timex?.status ?? null),
    rank: rankForInfluencer(leadInfluencer),
    winRate:
      leadInfluencer?.callAnalysis?.winRate ??
      leadInfluencer?.callAnalysis?.successScore ??
      leadInfluencer?.successRate?.weightedSuccessRate ??
      leadInfluencer?.successRate?.successRate ??
      alert.stats?.callAnalysis?.winRate ??
      0,
    performancePercent,
    mentionCount: alert.stats?.totalMentions ?? alert.consolidatedMentions?.length ?? 0,
    createdAt: observedAt,
    summary: `${alert.message ?? 'Alert activity detected'} · ${alert.stats?.totalInfluencers ?? 0} influencers`,
    posts: (alert.consolidatedMentions ?? []).map((rawMention, index) => {
      const mention = rawMention as BackendMentionWithLinks;
      return {
        id: toOptionalString(mention.id) ?? toOptionalString(mention.postId) ?? `${alertId}-${index}`,
        handle: mention.influencer ? `@${mention.influencer}` : '@unknown',
        text: mention.text ?? alert.message ?? `Mention detected for ${alert.token?.symbol ?? 'token'}`,
        postedAt: mention.mentionedAt ?? observedAt,
        sourceUrl: mention.sourceUrl ?? undefined
      };
    }),
    timex: [
      {
        label: alert.timex?.status ? `TIMEX ${alert.timex.status}` : 'TIMEX result',
        valuePercent: performancePercent
      }
    ],
    pricePoints
  };
}

function extractAlertList(response: BackendLiveEnvelope | BackendAlertsEnvelope): BackendAlert[] {
  const data = (response as BackendLiveEnvelope).data;
  if (Array.isArray(data)) {
    return data;
  }

  if (data && typeof data === 'object' && Array.isArray(data.data)) {
    return data.data;
  }

  return [];
}

function isAlertSignal(value: object): value is AlertSignal {
  const candidate = value as Partial<AlertSignal>;
  return Boolean(candidate.id && candidate.tokenSymbol && candidate.createdAt);
}

function looksLikeBackendAlert(value: object): value is BackendAlert {
  const candidate = value as Partial<BackendAlert>;
  return Boolean(candidate.token || candidate.alertId || candidate.sourceAlertId);
}

function toOptionalString(value: unknown): string | undefined {
  return value == null ? undefined : String(value);
}

function rankForInfluencer(influencer: BackendInfluencer | BackendRankedInfluencer | null): number {
  if (!influencer) {
    return 0;
  }

  if (influencer.leaderboardRank) {
    return influencer.leaderboardRank;
  }

  return 'rank' in influencer ? influencer.rank ?? 0 : 0;
}

function verdictFromPerformance(performancePercent: number, status: string | null): AlertVerdict {
  if (status === 'cancelled') {
    return 'AVOID';
  }

  if (performancePercent >= 1) {
    return 'SUPER TRADE';
  }

  return performancePercent >= 0 ? 'GOOD TRADE' : 'AVOID';
}

function mapTimexPricePoints(points: BackendTimexPricePoint[] | null | undefined) {
  const validPoints = (points ?? [])
    .filter((point) => point.t && typeof point.price === 'number')
    .map((point) => ({ at: point.t as string, price: point.price as number }));

  const firstPrice = validPoints[0]?.price ?? 0;
  return validPoints.map((point, index) => ({
    ...point,
    changePercent: firstPrice === 0 ? 0 : ((point.price - firstPrice) / firstPrice) * 100,
    label:
      index === 0
        ? 'Open'
        : index === validPoints.length - 1
          ? 'Close'
          : `T+${index}`
  }));
}
