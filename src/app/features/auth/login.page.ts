import { HttpClient } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { ApiUrlService } from '../../core/api/api-url.service';
import { AuthService } from '../../core/auth/auth.service';
import { FirebasePasswordAuthService } from '../../core/auth/firebase-password-auth.service';
import { appEnvironment } from '../../core/config/app-environment';

interface DevTokenResponse {
  token: string;
}

@Component({
  selector: 'ithac-login-page',
  imports: [FormsModule, RouterLink],
  template: `
    <main class="auth-page">
      <section class="auth-panel panel">
        <div class="brand">
          <span class="brand-mark">◆</span>
          <span>
            <strong>ITHAC</strong>
            <small>Signal portal</small>
          </span>
        </div>

        <header>
          <span class="eyebrow">Secure access</span>
          <h1>Signal desk</h1>
          <p class="muted">{{ subtitle }}</p>
        </header>

        @if (auth.status() === 'expired') {
          <p class="notice">Session expired. Sign in again to continue.</p>
        }

        @if (error()) {
          <p class="notice">{{ error() }}</p>
        }

        @if (isFirebasePasswordAuth) {
          <form (ngSubmit)="signIn()">
            <label>
              <span>Email</span>
              <input autocomplete="email" name="email" type="email" [(ngModel)]="email" required />
            </label>
            <label>
              <span>Password</span>
              <input
                autocomplete="current-password"
                name="password"
                type="password"
                [(ngModel)]="password"
                required
              />
            </label>
            <button class="button" type="submit" [disabled]="loading() || !email || !password">
              {{ loading() ? 'Signing in...' : 'Sign in' }}
            </button>
          </form>
        } @else {
          <button class="button" type="button" [disabled]="loading()" (click)="signIn()">
            {{ loading() ? 'Signing in...' : 'Continue to signal desk' }}
          </button>
        }

        <footer>
          <span class="status-pill dot" [class.ok]="!isFirebasePasswordAuth" [class.warn]="isFirebasePasswordAuth">
            {{ isFirebasePasswordAuth ? 'Firebase password' : 'Local dev token' }}
          </span>
          <a routerLink="/onboarding">Onboarding</a>
        </footer>
      </section>
    </main>
  `,
  styles: `
    .auth-page {
      display: grid;
      min-height: 100vh;
      place-items: center;
      padding: 1.25rem;
    }

    .auth-panel {
      display: grid;
      width: min(31rem, 100%);
      gap: 1.15rem;
      padding: 1.5rem;
      border-color: rgba(255, 176, 32, 0.22);
      background:
        linear-gradient(150deg, rgba(255, 176, 32, 0.08), rgba(255, 255, 255, 0.035)),
        var(--glass);
    }

    .brand,
    footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
    }

    .brand {
      justify-content: flex-start;
    }

    .brand-mark {
      display: grid;
      place-items: center;
      width: 2.65rem;
      height: 2.65rem;
      border-radius: 0.9rem;
      background: linear-gradient(150deg, var(--gold-bright), var(--gold-deep));
      color: #1a1003;
      box-shadow: 0 14px 28px -14px var(--gold-glow);
    }

    .brand span:last-child {
      display: grid;
      line-height: 1.15;
    }

    .brand strong {
      font-size: 1rem;
      letter-spacing: 0.14em;
    }

    .brand small,
    footer a {
      color: var(--ink-dim);
      font-size: 0.78rem;
    }

    header {
      display: grid;
      gap: 0.45rem;
    }

    .eyebrow {
      color: var(--gold);
      font-size: 0.74rem;
      font-weight: 500;
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }

    h1 {
      margin: 0;
      font-size: 2.3rem;
      font-weight: 500;
      letter-spacing: 0;
    }

    p {
      margin: 0;
    }

    .notice {
      border: 1px solid rgba(255, 93, 108, 0.28);
      border-radius: var(--radius-sm);
      background: rgba(255, 93, 108, 0.1);
      color: #ffb3bc;
      padding: 0.8rem 0.9rem;
      font-size: 0.9rem;
    }

    form {
      display: grid;
      gap: 0.9rem;
    }

    label {
      display: grid;
      gap: 0.4rem;
      color: var(--ink-muted);
      font-size: 0.84rem;
      font-weight: 500;
    }

    input {
      width: 100%;
      border: 1px solid var(--glass-border);
      border-radius: var(--radius-sm);
      background: rgba(255, 255, 255, 0.045);
      color: var(--ink);
      font: inherit;
      padding: 0.85rem 0.9rem;
      outline: none;
    }

    input:focus {
      border-color: rgba(255, 176, 32, 0.48);
      box-shadow: 0 0 0 3px rgba(255, 176, 32, 0.1);
    }

    .button {
      width: 100%;
    }

    .button:disabled {
      cursor: not-allowed;
      filter: grayscale(0.35);
      opacity: 0.65;
    }

    @media (max-width: 520px) {
      .auth-panel {
        padding: 1.1rem;
      }

      footer {
        align-items: flex-start;
        flex-direction: column;
      }
    }
  `
})
export class LoginPage {
  readonly auth = inject(AuthService);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly isFirebasePasswordAuth = appEnvironment.authProvider === 'firebase-password';
  readonly subtitle = this.isFirebasePasswordAuth
    ? 'Use your ITHAC account credentials.'
    : 'Local build mode signs in with a development token from the backend.';

  email = '';
  password = '';

  private readonly http = inject(HttpClient);
  private readonly apiUrl = inject(ApiUrlService);
  private readonly firebasePasswordAuth = inject(FirebasePasswordAuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  signIn(): void {
    this.error.set(null);

    if (appEnvironment.useMockData) {
      this.auth.signInMock();
      this.navigateAfterSignIn();
      return;
    }

    if (this.isFirebasePasswordAuth) {
      this.signInWithFirebasePassword();
      return;
    }

    this.signInWithDevToken();
  }

  private signInWithFirebasePassword(): void {
    this.loading.set(true);
    this.firebasePasswordAuth.signIn(this.email.trim(), this.password).subscribe({
      next: ({ token, user, refreshToken, expiresInSeconds }) => {
        this.auth.signInWithToken(token, user, {
          provider: 'firebase-password',
          refreshToken,
          expiresInSeconds
        });
        this.loading.set(false);
        this.navigateAfterSignIn();
      },
      error: (error: unknown) => {
        this.loading.set(false);
        this.error.set(error instanceof Error ? error.message : 'Unable to sign in');
      }
    });
  }

  private signInWithDevToken(): void {
    this.loading.set(true);
    this.http.get<DevTokenResponse>(this.apiUrl.endpoint('/api/TestJwt/generate-test-token')).subscribe({
      next: ({ token }) => {
        this.auth.signInWithToken(token, {
          id: 'local-dev-user',
          email: 'xavier@ithac.local',
          displayName: 'Xavier'
        });
        this.loading.set(false);
        this.navigateAfterSignIn();
      },
      error: (error: unknown) => {
        this.loading.set(false);
        this.error.set(error instanceof Error ? error.message : 'Unable to create local session');
      }
    });
  }

  private navigateAfterSignIn(): void {
    void this.router.navigateByUrl(this.route.snapshot.queryParamMap.get('redirectTo') ?? '/app/live');
  }
}
