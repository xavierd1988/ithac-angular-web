import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';

import { InfluencersApi } from './influencers.api';

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

    const request = httpMock.expectOne('http://127.0.0.1:5269/api/reputation/board?limit=100');
    request.flush([
      {
        rank: 12,
        influencerId: 'crypto-kd',
        username: 'cryptokd',
        name: 'Crypto KD',
        profileImageUrl: 'https://x.com/cryptokd/photo',
        totalScore: 352.8,
        avgScore: 8.4,
        evaluatedMentions: 42,
        positiveCalls: 28,
        negativeCalls: 10,
        neutralCalls: 4,
        lastUpdated: '2026-06-07T12:00:00Z'
      }
    ]);

    const profiles = await profilesPromise;

    expect(profiles.length).toBeGreaterThan(0);
    expect(profiles[0]?.handle).toContain('@');
    expect(profiles[0]?.id).toBe('crypto-kd');
    expect(profiles[0]?.winRate).toBeCloseTo(66.67, 1);
  });

  it('loads an influencer profile by id from the API', async () => {
    const profilePromise = firstValueFrom(api.getInfluencer('crypto-kd'));

    const request = httpMock.expectOne('http://127.0.0.1:5269/api/reputation/board?limit=200');
    request.flush([
      {
        rank: 12,
        influencerId: 'crypto-kd',
        username: 'cryptokd',
        name: 'Crypto KD',
        avgScore: 8.4,
        evaluatedMentions: 42,
        positiveCalls: 28,
        negativeCalls: 10,
        neutralCalls: 4
      }
    ]);

    const result = await profilePromise;

    expect(result.displayName).toBe('Crypto KD');
    expect(result.callsTracked).toBe(42);
  });
});
