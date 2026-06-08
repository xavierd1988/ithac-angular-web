import { TestBed } from '@angular/core/testing';

import { installMemoryLocalStorage } from '../../testing/memory-storage';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(() => {
    installMemoryLocalStorage();
    TestBed.configureTestingModule({});
    service = TestBed.inject(AuthService);
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('starts logged out', () => {
    expect(service.status()).toBe('logged-out');
    expect(service.isAuthenticated()).toBe(false);
    expect(service.token()).toBeNull();
  });

  it('creates a mock authenticated session', () => {
    service.signInMock();

    expect(service.status()).toBe('authenticated');
    expect(service.isAuthenticated()).toBe(true);
    expect(service.token()).toBe('mock-ithac-token-for-vertical-slice');
    expect(service.user()?.email).toBe('xavier@ithac.local');
    expect(service.provider()).toBe('local-dev');
    expect(service.canRefresh()).toBe(false);
  });

  it('stores Firebase refresh credentials with the session', () => {
    service.signInWithToken(
      'firebase-id-token',
      {
        id: 'firebase-user',
        email: 'xavier@example.com',
        displayName: 'Xavier'
      },
      {
        provider: 'firebase-password',
        refreshToken: 'firebase-refresh-token',
        expiresInSeconds: 3600
      }
    );

    expect(service.status()).toBe('authenticated');
    expect(service.provider()).toBe('firebase-password');
    expect(service.token()).toBe('firebase-id-token');
    expect(service.refreshToken()).toBe('firebase-refresh-token');
    expect(service.expiresAt()).toBeTruthy();
    expect(service.canRefresh()).toBe(true);
  });

  it('refreshes the authenticated token without losing the user', () => {
    service.signInWithToken(
      'old-token',
      {
        id: 'firebase-user',
        email: 'xavier@example.com',
        displayName: 'Xavier'
      },
      {
        provider: 'firebase-password',
        refreshToken: 'old-refresh-token',
        expiresInSeconds: 3600
      }
    );

    service.refreshAuthenticatedToken('new-token', {
      provider: 'firebase-password',
      refreshToken: 'new-refresh-token',
      expiresInSeconds: 3600
    });

    expect(service.status()).toBe('authenticated');
    expect(service.user()?.email).toBe('xavier@example.com');
    expect(service.token()).toBe('new-token');
    expect(service.refreshToken()).toBe('new-refresh-token');
  });

  it('expires the session after auth failure', () => {
    service.signInMock();
    service.markExpired();

    expect(service.status()).toBe('expired');
    expect(service.isAuthenticated()).toBe(false);
    expect(service.token()).toBeNull();
  });
});
