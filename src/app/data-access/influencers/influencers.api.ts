import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { delay, map, Observable, of, throwError } from 'rxjs';

import { ApiUrlService } from '../../core/api/api-url.service';
import { appEnvironment } from '../../core/config/app-environment';
import { MOCK_INFLUENCERS } from './influencers.fixtures';
import { InfluencerProfile } from './influencers.types';

interface BackendInfluencerRankingItem {
  rank: number;
  influencerId: string | number;
  username: string;
  name?: string | null;
  profileImageUrl?: string | null;
  totalScore?: number | null;
  avgScore?: number | null;
  evaluatedMentions?: number | null;
  positiveCalls?: number | null;
  negativeCalls?: number | null;
  neutralCalls?: number | null;
  lastUpdated?: string | null;
}

@Injectable({ providedIn: 'root' })
export class InfluencersApi {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = inject(ApiUrlService);

  listInfluencers(options: { limit?: number } = {}): Observable<InfluencerProfile[]> {
    if (appEnvironment.useMockData) {
      return of(MOCK_INFLUENCERS).pipe(delay(120));
    }

    const limit = Math.max(1, Math.min(options.limit ?? 100, 200));
    return this.http
      .get<BackendInfluencerRankingItem[]>(
        this.apiUrl.endpoint(`/api/reputation/board?limit=${limit}`)
      )
      .pipe(map((items) => items.map(mapBackendInfluencer)));
  }

  getInfluencer(influencerId: string): Observable<InfluencerProfile> {
    if (appEnvironment.useMockData) {
      const influencer = MOCK_INFLUENCERS.find((item) => item.id === influencerId);
      return influencer
        ? of(influencer).pipe(delay(120))
        : throwError(() => new Error('Influencer not found'));
    }

    return this.listInfluencers({ limit: 200 }).pipe(
      map((profiles) => {
        const match = profiles.find((profile) => profile.id === influencerId);
        if (!match) {
          throw new Error('Influencer not found');
        }

        return match;
      })
    );
  }
}

function mapBackendInfluencer(item: BackendInfluencerRankingItem): InfluencerProfile {
  const evaluatedMentions = item.evaluatedMentions ?? 0;
  const positiveCalls = item.positiveCalls ?? 0;
  const negativeCalls = item.negativeCalls ?? 0;
  const neutralCalls = item.neutralCalls ?? 0;
  const winRate = evaluatedMentions > 0 ? (positiveCalls / evaluatedMentions) * 100 : 0;
  const username = item.username || 'unknown';

  return {
    id: String(item.influencerId),
    displayName: item.name || username,
    handle: username.startsWith('@') ? username : `@${username}`,
    rank: item.rank,
    winRate,
    averagePerformancePercent: item.avgScore ?? 0,
    callsTracked: evaluatedMentions,
    profileImageUrl: item.profileImageUrl ?? undefined,
    totalScore: item.totalScore ?? 0,
    positiveCalls,
    negativeCalls,
    neutralCalls,
    lastUpdated: item.lastUpdated ?? undefined,
    specialties: [],
    latestSignals: []
  };
}
