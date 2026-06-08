import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { delay, Observable, of, throwError } from 'rxjs';

import { ApiUrlService } from '../../core/api/api-url.service';
import { appEnvironment } from '../../core/config/app-environment';
import { MOCK_INFLUENCERS } from './influencers.fixtures';
import { InfluencerProfile } from './influencers.types';

@Injectable({ providedIn: 'root' })
export class InfluencersApi {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = inject(ApiUrlService);

  listInfluencers(): Observable<InfluencerProfile[]> {
    if (appEnvironment.useMockData) {
      return of(MOCK_INFLUENCERS).pipe(delay(120));
    }

    return this.http.get<InfluencerProfile[]>(this.apiUrl.endpoint('/api/reputation/board'));
  }

  getInfluencer(influencerId: string): Observable<InfluencerProfile> {
    if (appEnvironment.useMockData) {
      const influencer = MOCK_INFLUENCERS.find((item) => item.id === influencerId);
      return influencer
        ? of(influencer).pipe(delay(120))
        : throwError(() => new Error('Influencer not found'));
    }

    return this.http.get<InfluencerProfile>(
      this.apiUrl.endpoint(`/api/reputation/board/${influencerId}`)
    );
  }
}
