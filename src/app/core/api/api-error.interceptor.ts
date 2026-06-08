import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, finalize, Observable, shareReplay, switchMap, tap, throwError } from 'rxjs';

import { AuthService } from '../auth/auth.service';
import {
  FirebasePasswordAuthService,
  FirebaseRefreshSession
} from '../auth/firebase-password-auth.service';

let firebaseRefreshInFlight$: Observable<FirebaseRefreshSession> | null = null;

export const apiErrorInterceptor: HttpInterceptorFn = (request, next) => {
  const auth = inject(AuthService);
  const firebaseAuth = inject(FirebasePasswordAuthService);

  return next(request).pipe(
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse && error.status === 401) {
        const refreshToken = auth.refreshToken();
        if (auth.canRefresh() && refreshToken) {
          return refreshFirebaseTokenOnce(auth, firebaseAuth, refreshToken).pipe(
            switchMap(({ token }) => {
              return next(
                request.clone({
                  setHeaders: {
                    Authorization: `Bearer ${token}`
                  }
                })
              ).pipe(
                catchError((retryError: unknown) => {
                  if (retryError instanceof HttpErrorResponse && retryError.status === 401) {
                    auth.markExpired();
                  }

                  return throwError(() => retryError);
                })
              );
            }),
            catchError((refreshError: unknown) => {
              auth.markExpired();
              return throwError(() => refreshError);
            })
          );
        }

        auth.markExpired();
      }

      return throwError(() => error);
    })
  );
};

function refreshFirebaseTokenOnce(
  auth: AuthService,
  firebaseAuth: FirebasePasswordAuthService,
  refreshToken: string
): Observable<FirebaseRefreshSession> {
  firebaseRefreshInFlight$ ??= firebaseAuth.refreshIdToken(refreshToken).pipe(
    tap(({ token, refreshToken: nextRefreshToken, expiresInSeconds }) => {
      auth.refreshAuthenticatedToken(token, {
        provider: 'firebase-password',
        refreshToken: nextRefreshToken,
        expiresInSeconds
      });
    }),
    finalize(() => {
      firebaseRefreshInFlight$ = null;
    }),
    shareReplay({ bufferSize: 1, refCount: false })
  );

  return firebaseRefreshInFlight$;
}
