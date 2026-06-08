import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';

import { InfluencersApi } from './influencers.api';
import { InfluencerProfile } from './influencers.types';

const profile: InfluencerProfile = {
  id: 'crypto-kd',
  displayName: 'Crypto KD',
  handle: '@cryptokd',
  rank: 12,
  winRate: 67,
  averagePerformancePercent: 8.4,
  callsTracked: 42,
  specialties: ['DeFi'],
  latestSignals: [
    {
      tokenSymbol: 'BTC',
      verdict: 'GOOD TRADE',
      performancePercent: 4.2,
      calledAt: '2026-06-07T12:00:00Z'
    }
  ]
};

describe('InfluencersApi', () => {
  let api: InfluencersApi;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()]
    });

    api = TestBed.inject(InfluencersApi);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('loads influencer profiles from the API', async () => {
    const profilesPromise = firstValueFrom(api.listInfluencers());

    const request = httpMock.expectOne('http://127.0.0.1:5269/api/reputation/board');
    request.flush([profile]);

    const profiles = await profilesPromise;

    expect(profiles.length).toBeGreaterThan(0);
    expect(profiles[0]?.handle).toContain('@');
  });

  it('loads an influencer profile by id from the API', async () => {
    const profilePromise = firstValueFrom(api.getInfluencer('crypto-kd'));

    const request = httpMock.expectOne('http://127.0.0.1:5269/api/reputation/board/crypto-kd');
    request.flush(profile);

    const result = await profilePromise;

    expect(result.displayName).toBe('Crypto KD');
    expect(result.latestSignals.length).toBeGreaterThan(0);
  });
});
