import { HttpBackend, HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { catchError, map, Observable, throwError } from 'rxjs';

import { appEnvironment } from '../config/app-environment';
import type { AuthUser } from './auth.service';

interface FirebasePasswordResponse {
  idToken: string;
  refreshToken: string;
  expiresIn: string;
  email: string;
  localId: string;
  displayName?: string;
}

interface FirebaseRefreshResponse {
  id_token: string;
  refresh_token: string;
  expires_in: string;
  user_id: string;
}

interface FirebaseErrorResponse {
  error?: {
    message?: string;
  };
}

export interface FirebasePasswordSession {
  token: string;
  refreshToken: string;
  expiresInSeconds: number;
  user: AuthUser;
}

export interface FirebaseRefreshSession {
  token: string;
  refreshToken: string;
  expiresInSeconds: number;
}

@Injectable({ providedIn: 'root' })
export class FirebasePasswordAuthService {
  private readonly http = new HttpClient(inject(HttpBackend));

  signIn(email: string, password: string): Observable<FirebasePasswordSession> {
    const apiKey = appEnvironment.firebase.webApiKey.trim();

    if (!apiKey) {
      return throwError(() => new Error('Firebase web API key is missing'));
    }

    return this.http
      .post<FirebasePasswordResponse>(
        `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`,
        {
          email,
          password,
          returnSecureToken: true
        }
      )
      .pipe(
        map((response) => ({
          token: response.idToken,
          refreshToken: response.refreshToken,
          expiresInSeconds: parseExpiresIn(response.expiresIn),
          user: {
            id: response.localId,
            email: response.email,
            displayName: response.displayName || response.email
          }
        })),
        catchError((error: unknown) => {
          if (error instanceof HttpErrorResponse) {
            return throwError(() => new Error(firebaseErrorMessage(error)));
          }

          return throwError(() => error);
        })
      );
  }

  refreshIdToken(refreshToken: string): Observable<FirebaseRefreshSession> {
    const apiKey = appEnvironment.firebase.webApiKey.trim();

    if (!apiKey) {
      return throwError(() => new Error('Firebase web API key is missing'));
    }

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    }).toString();

    return this.http
      .post<FirebaseRefreshResponse>(
        `https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(apiKey)}`,
        body,
        {
          headers: new HttpHeaders({
            'Content-Type': 'application/x-www-form-urlencoded'
          })
        }
      )
      .pipe(
        map((response) => ({
          token: response.id_token,
          refreshToken: response.refresh_token,
          expiresInSeconds: parseExpiresIn(response.expires_in)
        })),
        catchError((error: unknown) => {
          if (error instanceof HttpErrorResponse) {
            return throwError(() => new Error(firebaseErrorMessage(error)));
          }

          return throwError(() => error);
        })
      );
  }
}

function parseExpiresIn(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3600;
}

function firebaseErrorMessage(error: HttpErrorResponse): string {
  const body = error.error as FirebaseErrorResponse | null;
  const code = body?.error?.message;

  if (
    code === 'EMAIL_NOT_FOUND' ||
    code === 'INVALID_PASSWORD' ||
    code === 'INVALID_LOGIN_CREDENTIALS'
  ) {
    return 'Invalid email or password';
  }

  if (code === 'USER_DISABLED') {
    return 'This user account is disabled';
  }

  if (code === 'TOO_MANY_ATTEMPTS_TRY_LATER') {
    return 'Too many attempts, try again later';
  }

  return 'Unable to sign in with Firebase';
}
