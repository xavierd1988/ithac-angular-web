import { DatePipe } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';

import { AuthService } from '../../core/auth/auth.service';
import { appEnvironment } from '../../core/config/app-environment';
import { SignalrService } from '../../core/realtime/signalr.service';
import { HealthApi, HealthStatus } from '../../data-access/system/health.api';

@Component({
  selector: 'ithac-settings-page',
  imports: [DatePipe],
  template: `
    <main class="page settings">
      <header>
        <div>
          <span class="eyebrow">Control room</span>
          <h1>Settings</h1>
          <p class="muted sub">Runtime, account and integration state for this web build.</p>
        </div>
        <span class="status-pill dot" [class.ok]="health()?.status === 'healthy'" [class.bad]="health()?.status !== 'healthy'">
          API {{ health()?.status ?? 'checking' }}
        </span>
      </header>

      <section class="grid">
        <article class="panel block hero-block">
          <div class="identity">
            <span class="avatar">{{ initials() }}</span>
            <span>
              <strong>{{ auth.user()?.displayName ?? 'No active user' }}</strong>
              <small class="muted">{{ auth.user()?.email ?? 'Signed out' }}</small>
            </span>
          </div>

          <dl class="stats">
            <div>
              <dt>Session</dt>
              <dd>{{ auth.status() }}</dd>
            </div>
            <div>
              <dt>Auth mode</dt>
              <dd>{{ authProviderLabel() }}</dd>
            </div>
            <div>
              <dt>Premium</dt>
              <dd>Mock gate</dd>
            </div>
          </dl>

          <button class="button secondary" type="button" (click)="auth.signOut()">Sign out</button>
        </article>

        <article class="panel block">
          <div class="block-head">
            <h2>Backend</h2>
            <span class="status-pill dot" [class.ok]="health()?.database === 'connected'" [class.bad]="health()?.database !== 'connected'">
              DB {{ health()?.database ?? 'unknown' }}
            </span>
          </div>

          <dl class="stack">
            <div>
              <dt>API base</dt>
              <dd class="ellipsis">{{ apiBaseUrl }}</dd>
            </div>
            <div>
              <dt>Data source</dt>
              <dd>{{ useMockData ? 'Mock fixtures' : 'Live API' }}</dd>
            </div>
            <div>
              <dt>Last check</dt>
              <dd>{{ lastChecked() ? (lastChecked() | date: 'shortTime') : 'Pending' }}</dd>
            </div>
          </dl>

          <button class="button secondary" type="button" (click)="refreshHealth()">Check API</button>
        </article>

        <article class="panel block">
          <div class="block-head">
            <h2>Realtime</h2>
            <span
              class="status-pill dot"
              [class.ok]="
                realtime.status() === 'connected' ||
                realtime.status() === 'mock' ||
                realtime.status() === 'disabled'
              "
              [class.warn]="realtime.status() === 'connecting' || realtime.status() === 'reconnecting'"
              [class.bad]="realtime.status() === 'error' || realtime.status() === 'disconnected'"
            >
              {{ realtime.status() === 'disabled' ? 'standby' : realtime.status() }}
            </span>
          </div>

          <dl class="stack">
            <div>
              <dt>Hub</dt>
              <dd class="ellipsis">{{ signalrHubUrl }}</dd>
            </div>
            <div>
              <dt>Enabled</dt>
              <dd>{{ enableRealtime ? 'Yes' : 'No' }}</dd>
            </div>
            <div>
              <dt>Last error</dt>
              <dd class="ellipsis">{{ realtime.lastError() ?? 'None' }}</dd>
            </div>
          </dl>

          <button
            class="button secondary"
            type="button"
            [disabled]="!enableRealtime"
            (click)="reconnectRealtime()"
          >
            Reconnect
          </button>
        </article>

        <article class="panel block">
          <div class="block-head">
            <h2>Firebase</h2>
            <span class="status-pill dot" [class.ok]="firebaseReady()" [class.warn]="!firebaseReady()">
              {{ firebaseReady() ? 'ready' : 'missing key' }}
            </span>
          </div>

          <dl class="stack">
            <div>
              <dt>Provider</dt>
              <dd>{{ authProviderLabel() }}</dd>
            </div>
            <div>
              <dt>Web API key</dt>
              <dd>{{ firebaseReady() ? 'Configured' : 'Not configured' }}</dd>
            </div>
            <div>
              <dt>Next switch</dt>
              <dd>{{ firebaseReady() ? 'Flip authProvider' : 'Add Web API key' }}</dd>
            </div>
          </dl>
        </article>
      </section>
    </main>
  `,
  styles: `
    .settings {
      display: grid;
      gap: 1.5rem;
    }

    header,
    .block-head {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 1rem;
      flex-wrap: wrap;
    }

    .eyebrow {
      color: var(--gold);
      font-size: 0.76rem;
      font-weight: 500;
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }

    h1,
    h2 {
      margin: 0;
      font-weight: 500;
      letter-spacing: 0;
    }

    h1 {
      margin-top: 0.45rem;
      font-size: 2.5rem;
    }

    h2 {
      font-size: 1rem;
    }

    .sub {
      margin: 0.25rem 0 0;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 1rem;
    }

    .block {
      display: grid;
      align-content: start;
      gap: 1rem;
      padding: 1.25rem;
    }

    .hero-block {
      border-color: rgba(255, 176, 32, 0.22);
      background: linear-gradient(150deg, rgba(255, 176, 32, 0.08), rgba(255, 255, 255, 0.035));
    }

    .identity {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      gap: 0.85rem;
      align-items: center;
    }

    .identity span:last-child {
      display: grid;
      min-width: 0;
      gap: 0.2rem;
    }

    .identity strong {
      font-size: 1.2rem;
    }

    .avatar {
      display: grid;
      place-items: center;
      width: 3rem;
      height: 3rem;
      border-radius: var(--radius-sm);
      border: 1px solid rgba(255, 176, 32, 0.32);
      background: rgba(255, 176, 32, 0.1);
      color: var(--gold-bright);
      font-weight: 500;
      text-transform: uppercase;
    }

    dl {
      margin: 0;
    }

    .stats,
    .stack {
      display: grid;
      gap: 0.7rem;
    }

    .stats {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .stats div,
    .stack div {
      min-width: 0;
      border: 1px solid var(--glass-border);
      border-radius: var(--radius-sm);
      background: rgba(255, 255, 255, 0.03);
      padding: 0.7rem 0.75rem;
    }

    dt {
      color: var(--ink-dim);
      font-size: 0.68rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    dd {
      margin: 0.22rem 0 0;
      font-weight: 500;
      font-variant-numeric: tabular-nums;
    }

    .ellipsis {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    @media (max-width: 900px) {
      .grid,
      .stats {
        grid-template-columns: 1fr;
      }

      h1 {
        font-size: 2rem;
      }
    }
  `
})
export class SettingsPage implements OnInit {
  readonly auth = inject(AuthService);
  readonly realtime = inject(SignalrService);

  readonly health = signal<HealthStatus | null>(null);
  readonly lastChecked = signal<string | null>(null);
  readonly apiBaseUrl = appEnvironment.apiBaseUrl;
  readonly signalrHubUrl = appEnvironment.signalrHubUrl;
  readonly useMockData = appEnvironment.useMockData;
  readonly enableRealtime = appEnvironment.enableRealtime;

  readonly firebaseReady = computed(() => appEnvironment.firebase.webApiKey.trim().length > 0);
  readonly authProviderLabel = computed(() =>
    appEnvironment.authProvider === 'firebase-password' ? 'Firebase password' : 'Local dev token'
  );
  readonly initials = computed(() =>
    (this.auth.user()?.displayName ?? this.auth.user()?.email ?? 'IT')
      .split(/\s|@/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
  );

  private readonly healthApi = inject(HealthApi);

  ngOnInit(): void {
    this.refreshHealth();
    this.realtime.connect();
  }

  refreshHealth(): void {
    this.healthApi.check().subscribe({
      next: (health) => {
        this.health.set(health);
        this.lastChecked.set(new Date().toISOString());
      },
      error: () => {
        this.health.set({ status: 'unreachable' });
        this.lastChecked.set(new Date().toISOString());
      }
    });
  }

  reconnectRealtime(): void {
    this.realtime.disconnect();
    window.setTimeout(() => this.realtime.connect(), 100);
  }
}
