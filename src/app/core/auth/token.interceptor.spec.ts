import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { installMemoryLocalStorage } from '../../testing/memory-storage';
import { apiErrorInterceptor } from '../api/api-error.interceptor';
import { appEnvironment } from '../config/app-environment';
import { AuthService } from './auth.service';
import { tokenInterceptor } from './token.interceptor';

describe('auth HTTP interceptors', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  let auth: AuthService;
  let originalApiKey: string;

  beforeEach(() => {
    installMemoryLocalStorage();
    originalApiKey = appEnvironment.firebase.webApiKey;
    appEnvironment.firebase.webApiKey = 'test-api-key';
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([tokenInterceptor, apiErrorInterceptor])),
        provideHttpClientTesting()
      ]
    });

    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(AuthService);
  });

  afterEach(() => {
    httpMock.verify();
    appEnvironment.firebase.webApiKey = originalApiKey;
    localStorage.clear();
  });

  it('adds the bearer token to protected requests', () => {
    auth.signInMock();

    http.get('/api/protected').subscribe();

    const request = httpMock.expectOne('/api/protected');
    expect(request.request.headers.get('Authorization')).toBe(
      'Bearer mock-ithac-token-for-vertical-slice'
    );
    request.flush({});
  });

  it('does not add the bearer token to health checks', () => {
    auth.signInMock();

    http.get('https://cointrends-api.dukanify.com/health').subscribe();

    const request = httpMock.expectOne('https://cointrends-api.dukanify.com/health');
    expect(request.request.headers.has('Authorization')).toBe(false);
    request.flush({ status: 'healthy' });
  });

  it('marks the session expired on 401', () => {
    auth.signInMock();
    let sawError = false;

    http.get('/api/protected').subscribe({
      error: () => {
        sawError = true;
      }
    });

    const request = httpMock.expectOne('/api/protected');
    request.flush(
      {},
      {
        status: 401,
        statusText: 'Unauthorized'
      }
    );

    expect(sawError).toBe(true);
    expect(auth.status()).toBe('expired');
  });

  it('refreshes Firebase sessions on 401 and retries the request once', () => {
    auth.signInWithToken(
      'expired-firebase-token',
      {
        id: 'firebase-user-id',
        email: 'xavier@example.com',
        displayName: 'Xavier'
      },
      {
        provider: 'firebase-password',
        refreshToken: 'firebase-refresh-token',
        expiresInSeconds: 3600
      }
    );
    let sawResponse = false;

    http.get('/api/protected').subscribe(() => {
      sawResponse = true;
    });

    const firstRequest = httpMock.expectOne('/api/protected');
    expect(firstRequest.request.headers.get('Authorization')).toBe(
      'Bearer expired-firebase-token'
    );
    firstRequest.flush(
      {},
      {
        status: 401,
        statusText: 'Unauthorized'
      }
    );

    const refreshRequest = httpMock.expectOne(
      'https://securetoken.googleapis.com/v1/token?key=test-api-key'
    );
    expect(refreshRequest.request.method).toBe('POST');
    refreshRequest.flush({
      id_token: 'fresh-firebase-token',
      refresh_token: 'fresh-refresh-token',
      expires_in: '3600',
      user_id: 'firebase-user-id'
    });

    const retryRequest = httpMock.expectOne('/api/protected');
    expect(retryRequest.request.headers.get('Authorization')).toBe('Bearer fresh-firebase-token');
    retryRequest.flush({ ok: true });

    expect(sawResponse).toBe(true);
    expect(auth.status()).toBe('authenticated');
    expect(auth.token()).toBe('fresh-firebase-token');
    expect(auth.refreshToken()).toBe('fresh-refresh-token');
  });

  it('shares one Firebase refresh across concurrent 401 responses', () => {
    auth.signInWithToken(
      'expired-firebase-token',
      {
        id: 'firebase-user-id',
        email: 'xavier@example.com',
        displayName: 'Xavier'
      },
      {
        provider: 'firebase-password',
        refreshToken: 'firebase-refresh-token',
        expiresInSeconds: 3600
      }
    );
    let firstResponse = false;
    let secondResponse = false;

    http.get('/api/protected-a').subscribe(() => {
      firstResponse = true;
    });
    http.get('/api/protected-b').subscribe(() => {
      secondResponse = true;
    });

    const firstRequest = httpMock.expectOne('/api/protected-a');
    const secondRequest = httpMock.expectOne('/api/protected-b');
    firstRequest.flush(
      {},
      {
        status: 401,
        statusText: 'Unauthorized'
      }
    );
    secondRequest.flush(
      {},
      {
        status: 401,
        statusText: 'Unauthorized'
      }
    );

    const refreshRequests = httpMock.match(
      'https://securetoken.googleapis.com/v1/token?key=test-api-key'
    );
    expect(refreshRequests.length).toBe(1);
    refreshRequests[0].flush({
      id_token: 'shared-fresh-token',
      refresh_token: 'shared-refresh-token',
      expires_in: '3600',
      user_id: 'firebase-user-id'
    });

    const firstRetry = httpMock.expectOne('/api/protected-a');
    const secondRetry = httpMock.expectOne('/api/protected-b');
    expect(firstRetry.request.headers.get('Authorization')).toBe('Bearer shared-fresh-token');
    expect(secondRetry.request.headers.get('Authorization')).toBe('Bearer shared-fresh-token');
    firstRetry.flush({ ok: true });
    secondRetry.flush({ ok: true });

    expect(firstResponse).toBe(true);
    expect(secondResponse).toBe(true);
    expect(auth.token()).toBe('shared-fresh-token');
    expect(auth.refreshToken()).toBe('shared-refresh-token');
  });
});
