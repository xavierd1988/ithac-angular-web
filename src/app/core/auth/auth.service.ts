import { computed, Injectable, signal } from '@angular/core';

import { AuthProvider } from '../config/app-environment';

export type AuthStatus = 'loading' | 'logged-out' | 'authenticated' | 'expired';

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
}

interface AuthSession {
  status: AuthStatus;
  token: string | null;
  user: AuthUser | null;
  provider: AuthProvider;
  refreshToken: string | null;
  expiresAt: string | null;
}

export interface AuthTokenOptions {
  provider?: AuthProvider;
  refreshToken?: string | null;
  expiresInSeconds?: number | string | null;
}

const LEGACY_STORAGE_KEY = 'ithac.mock-session';
const STORAGE_KEY = 'ithac.auth-session';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly session = signal<AuthSession>(this.readSession());

  readonly status = computed(() => this.session().status);
  readonly user = computed(() => this.session().user);
  readonly isAuthenticated = computed(() => this.session().status === 'authenticated');
  readonly provider = computed(() => this.session().provider);
  readonly expiresAt = computed(() => this.session().expiresAt);
  readonly canRefresh = computed(
    () =>
      this.session().status === 'authenticated' &&
      this.session().provider === 'firebase-password' &&
      Boolean(this.session().refreshToken)
  );

  token(): string | null {
    return this.session().token;
  }

  refreshToken(): string | null {
    return this.session().refreshToken;
  }

  signInMock(): void {
    this.signInWithToken('mock-ithac-token-for-vertical-slice', {
      id: 'demo-user',
      email: 'xavier@ithac.local',
      displayName: 'Xavier'
    });
  }

  signInWithToken(token: string, user: AuthUser, options: AuthTokenOptions = {}): void {
    const session: AuthSession = {
      status: 'authenticated',
      token,
      user,
      provider: options.provider ?? 'local-dev',
      refreshToken: options.refreshToken ?? null,
      expiresAt: expiresAtFrom(options.expiresInSeconds)
    };

    this.writeSession(session);
  }

  refreshAuthenticatedToken(token: string, options: AuthTokenOptions = {}): void {
    const current = this.session();
    if (!current.user) {
      this.markExpired();
      return;
    }

    this.writeSession({
      ...current,
      status: 'authenticated',
      token,
      provider: options.provider ?? current.provider,
      refreshToken: options.refreshToken ?? current.refreshToken,
      expiresAt: expiresAtFrom(options.expiresInSeconds) ?? current.expiresAt
    });
  }

  markExpired(): void {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    this.session.set({
      status: 'expired',
      token: null,
      user: null,
      provider: 'local-dev',
      refreshToken: null,
      expiresAt: null
    });
  }

  signOut(): void {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    this.session.set({
      status: 'logged-out',
      token: null,
      user: null,
      provider: 'local-dev',
      refreshToken: null,
      expiresAt: null
    });
  }

  private readSession(): AuthSession {
    const fallback: AuthSession = {
      status: 'logged-out',
      token: null,
      user: null,
      provider: 'local-dev',
      refreshToken: null,
      expiresAt: null
    };

    try {
      const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
      if (!raw) {
        return fallback;
      }

      const parsed = JSON.parse(raw) as Partial<AuthSession>;
      return {
        status: parsed.status ?? fallback.status,
        token: parsed.token ?? null,
        user: parsed.user ?? null,
        provider: parsed.provider ?? 'local-dev',
        refreshToken: parsed.refreshToken ?? null,
        expiresAt: parsed.expiresAt ?? null
      };
    } catch {
      return fallback;
    }
  }

  private writeSession(session: AuthSession): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    this.session.set(session);
  }
}

function expiresAtFrom(expiresInSeconds: AuthTokenOptions['expiresInSeconds']): string | null {
  if (expiresInSeconds == null) {
    return null;
  }

  const seconds =
    typeof expiresInSeconds === 'string' ? Number.parseInt(expiresInSeconds, 10) : expiresInSeconds;

  if (!Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }

  return new Date(Date.now() + seconds * 1000).toISOString();
}
