import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { appEnvironment } from '../config/app-environment';
import { FirebasePasswordAuthService } from './firebase-password-auth.service';

describe('FirebasePasswordAuthService', () => {
  let service: FirebasePasswordAuthService;
  let httpMock: HttpTestingController;
  let originalApiKey: string;

  beforeEach(() => {
    originalApiKey = appEnvironment.firebase.webApiKey;
    appEnvironment.firebase.webApiKey = 'test-api-key';

    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()]
    });

    service = TestBed.inject(FirebasePasswordAuthService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    appEnvironment.firebase.webApiKey = originalApiKey;
  });

  it('exchanges email and password for a Firebase ID token', () => {
    let sessionToken = '';
    let sessionEmail = '';

    service.signIn('xavier@example.com', 'secret').subscribe((session) => {
      sessionToken = session.token;
      sessionEmail = session.user.email;
    });

    const request = httpMock.expectOne(
      'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=test-api-key'
    );
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      email: 'xavier@example.com',
      password: 'secret',
      returnSecureToken: true
    });

    request.flush({
      idToken: 'firebase-id-token',
      refreshToken: 'firebase-refresh-token',
      expiresIn: '3600',
      email: 'xavier@example.com',
      localId: 'firebase-user-id',
      displayName: 'Xavier'
    });

    expect(sessionToken).toBe('firebase-id-token');
    expect(sessionEmail).toBe('xavier@example.com');
  });

  it('refreshes a Firebase ID token with a refresh token', () => {
    let sessionToken = '';
    let refreshToken = '';

    service.refreshIdToken('old-refresh-token').subscribe((session) => {
      sessionToken = session.token;
      refreshToken = session.refreshToken;
    });

    const request = httpMock.expectOne(
      'https://securetoken.googleapis.com/v1/token?key=test-api-key'
    );
    expect(request.request.method).toBe('POST');
    expect(request.request.headers.get('Content-Type')).toBe('application/x-www-form-urlencoded');
    expect(request.request.body).toBe(
      'grant_type=refresh_token&refresh_token=old-refresh-token'
    );

    request.flush({
      id_token: 'fresh-id-token',
      refresh_token: 'fresh-refresh-token',
      expires_in: '3600',
      user_id: 'firebase-user-id'
    });

    expect(sessionToken).toBe('fresh-id-token');
    expect(refreshToken).toBe('fresh-refresh-token');
  });

  it('fails before the network call when the Firebase API key is missing', () => {
    appEnvironment.firebase.webApiKey = '';
    let message = '';

    service.signIn('xavier@example.com', 'secret').subscribe({
      error: (error: unknown) => {
        message = error instanceof Error ? error.message : '';
      }
    });

    expect(message).toBe('Firebase web API key is missing');
  });
});
