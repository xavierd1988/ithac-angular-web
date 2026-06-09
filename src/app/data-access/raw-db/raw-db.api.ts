import { HttpBackend, HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map } from 'rxjs';

import { appEnvironment } from '../../core/config/app-environment';
import { RawDbInfluencersResponse, RawDbMention, RawDbScrapeHealth } from './raw-db.types';

interface RawDbLiveResponse {
  data?: RawDbAlert[];
}

interface RawDbAlert {
  alertId?: string | number;
  sourceAlertId?: string | number;
  detectedAt?: string | null;
  timestamp?: string | null;
  message?: string | null;
  token?: {
    symbol?: string | null;
    name?: string | null;
  } | null;
  rankedInfluencers?: RawDbInfluencer[] | null;
  topInfluencers?: RawDbInfluencer[] | null;
  consolidatedMentions?: RawDbPost[] | null;
}

interface RawDbInfluencer {
  username?: string | null;
}

interface RawDbPost {
  id?: string | number | null;
  postId?: string | number | null;
  influencer?: string | null;
  mentionedAt?: string | null;
  text?: string | null;
  sourceUrl?: string | null;
}

@Injectable({ providedIn: 'root' })
export class RawDbApi {
  private readonly http = new HttpClient(inject(HttpBackend));
  private readonly baseUrl = appEnvironment.rawDbApiBaseUrl.replace(/\/$/, '');

  listMentions(limit = 30) {
    const safeLimit = Math.max(1, Math.min(Math.trunc(limit), 100));
    return this.http.get<RawDbLiveResponse>(`${this.baseUrl}/api/live?limit=${safeLimit}`).pipe(
      map((response) => (response.data ?? []).map(mapRawDbAlert))
    );
  }

  listInfluencers(limit = 2500) {
    const safeLimit = Math.max(1, Math.min(Math.trunc(limit), 5000));
    return this.http.get<RawDbInfluencersResponse>(
      `${this.baseUrl}/api/raw/influencers?limit=${safeLimit}`
    );
  }

  getScrapeHealth() {
    return this.http.get<RawDbScrapeHealth>(`${this.baseUrl}/api/raw/scrape-health`);
  }
}

function mapRawDbAlert(alert: RawDbAlert): RawDbMention {
  const post = alert.consolidatedMentions?.[0] ?? {};
  const influencer =
    post.influencer ??
    alert.rankedInfluencers?.[0]?.username ??
    alert.topInfluencers?.[0]?.username ??
    'unknown';
  const cleanInfluencer = influencer.replace(/^@/, '');
  const id = toStringValue(alert.sourceAlertId ?? alert.alertId ?? post.id ?? post.postId);

  return {
    id,
    postId: toStringValue(post.postId ?? id),
    tokenSymbol: alert.token?.symbol ?? 'N/A',
    tokenName: alert.token?.name ?? alert.token?.symbol ?? 'Unknown token',
    influencer: `@${cleanInfluencer}`,
    profileUrl: `https://x.com/${cleanInfluencer}`,
    postUrl: post.sourceUrl ?? null,
    text: post.text ?? alert.message ?? '',
    mentionedAt: post.mentionedAt ?? alert.detectedAt ?? alert.timestamp ?? ''
  };
}

function toStringValue(value: unknown): string {
  return value == null ? 'unknown' : String(value);
}
