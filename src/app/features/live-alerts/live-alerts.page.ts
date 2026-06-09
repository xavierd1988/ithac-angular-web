import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, effect, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { SignalrService } from '../../core/realtime/signalr.service';
import { AlertsApi, coerceLiveAlertEvent } from '../../data-access/alerts/alerts.api';
import { AlertSignal } from '../../data-access/alerts/alerts.types';
import { HealthApi, HealthStatus } from '../../data-access/system/health.api';

@Component({
  selector: 'ithac-live-alerts-page',
  imports: [DatePipe, DecimalPipe, RouterLink],
  template: `
    <main class="page live">
      <header>
        <div class="title">
          <span class="eyebrow"><span class="live-dot"></span>Live Alerts</span>
          <h1>Signal feed</h1>
          <p class="muted sub">Who is calling what — and whether their calls land.</p>
        </div>
        <div class="header-status">
          <span
            class="status-pill dot"
            [class.ok]="health()?.status === 'healthy'"
            [class.bad]="!health() || health()?.status === 'unreachable'"
            >API {{ health()?.status ?? 'checking' }}</span
          >
          <span
            class="status-pill dot"
            [class.ok]="
              realtime.status() === 'connected' ||
              realtime.status() === 'mock' ||
              realtime.status() === 'disabled'
            "
            [class.warn]="
              realtime.status() === 'connecting' || realtime.status() === 'reconnecting'
            "
            [class.bad]="realtime.status() === 'error' || realtime.status() === 'disconnected'"
            >Realtime {{ realtime.status() === 'disabled' ? 'standby' : realtime.status() }}</span
          >
          <button class="button secondary refresh" type="button" [disabled]="refreshing()" (click)="refreshAlerts()">
            {{ refreshing() ? 'Refreshing' : 'Refresh' }}
          </button>
        </div>
      </header>

      <section class="live-strip panel">
        <span>
          <strong>{{ loading() && alerts().length === 0 ? '...' : alerts().length }}</strong>
          {{ loading() && alerts().length === 0 ? 'loading signals' : 'active signals' }}
        </span>
        <span>
          <strong>{{ newAlertCount() }}</strong>
          new
        </span>
        <span>
          Updated
          <strong>{{ lastUpdatedAt() ? relativeTime(lastUpdatedAt()!) : 'pending' }}</strong>
        </span>
      </section>

      @if (error()) {
        <section class="panel message error">{{ error() }}</section>
      }

      @if (loading()) {
        <section class="alerts-list" aria-hidden="true">
          @for (i of skeletons; track i) {
            <div class="alert-row panel skeleton"></div>
          }
        </section>
      } @else if (alerts().length === 0) {
        <section class="panel message empty">
          <span class="empty-mark">◆</span>
          <strong>No active signals right now</strong>
          <span class="muted">New alerts appear here as influencers move.</span>
        </section>
      } @else {
        <section class="alerts-list" aria-label="Live alert feed">
          @for (alert of alerts(); track alert.id; let index = $index) {
            <article class="alert-row panel" [class.new]="isNewAlert(alert.id)">
              <span class="card-accent" aria-hidden="true"></span>

              <span class="row-index">{{ index + 1 | number: '2.0-0' }}</span>

              <div class="token-cell">
                <span class="token-avatar">{{ alert.tokenSymbol.slice(0, 3) }}</span>
                <span class="token-meta">
                  <strong class="token-sym">{{ alert.tokenSymbol }}</strong>
                  <small class="muted ellipsis">{{ alert.tokenName }}</small>
                </span>
              </div>

              <div class="caller-cell">
                <span class="field-label">Caller</span>
                <a
                  class="profile-link ellipsis"
                  [href]="profileUrl(alert)"
                  target="_blank"
                  rel="noopener noreferrer"
                  [attr.aria-label]="'Open X profile for ' + alert.callerHandle"
                  >{{ alert.callerHandle }}</a
                >
                <small class="muted ellipsis">{{ alert.summary }}</small>
                <div class="quick-links">
                  @if (primaryPostUrl(alert); as postUrl) {
                    <a
                      class="quick-link"
                      [href]="postUrl"
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="Open original post on X"
                      >Post</a
                    >
                  }
                  <a class="quick-link" [routerLink]="['/app/alerts', alert.id]">Details</a>
                </div>
              </div>

              <span
                class="verdict"
                [class.super]="alert.verdict === 'SUPER TRADE'"
                [class.good]="alert.verdict === 'GOOD TRADE'"
                [class.avoid]="alert.verdict === 'AVOID'"
                >{{ alert.verdict }}</span
              >

              <div class="perf" [class.negative]="alert.performancePercent < 0">
                <span class="perf-value"
                  >{{ alert.performancePercent >= 0 ? '+' : ''
                  }}{{ alert.performancePercent | number: '1.1-1' }}%</span
                >
                <span class="perf-label">TIMEX</span>
              </div>

              <dl class="stats compact">
                <div>
                  <dt>Rank</dt>
                  <dd>#{{ alert.rank }}</dd>
                </div>
                <div>
                  <dt>Mentions</dt>
                  <dd>{{ alert.mentionCount }}</dd>
                </div>
              </dl>

              <footer class="row-time">
                <time [dateTime]="alert.createdAt" [title]="(alert.createdAt | date: 'medium') ?? ''">
                  {{ relativeTime(alert.createdAt) }}
                </time>
                @if (isNewAlert(alert.id)) {
                  <span class="new-badge">New</span>
                }
              </footer>
            </article>
          }
        </section>
      }
    </main>
  `,
  styles: `
    .live {
      display: grid;
      gap: 1.5rem;
    }

    header {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 1rem;
      flex-wrap: wrap;
    }

    .eyebrow {
      display: inline-flex;
      align-items: center;
      gap: 0.45rem;
      color: var(--gold);
      font-size: 0.76rem;
      font-weight: 500;
      letter-spacing: 0.16em;
      text-transform: uppercase;
    }

    .live-dot {
      width: 0.5rem;
      height: 0.5rem;
      border-radius: 999px;
      background: var(--gold);
      box-shadow: 0 0 10px rgba(255, 176, 32, 0.55);
    }

    h1 {
      margin: 0.5rem 0 0.25rem;
      font-size: 2.5rem;
      font-weight: 500;
      letter-spacing: 0;
    }

    .sub {
      margin: 0;
      font-size: 0.95rem;
    }

    .header-status {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 0.5rem;
    }

    .refresh {
      min-height: 2rem;
      padding: 0.42rem 0.75rem;
      font-size: 0.78rem;
    }

    .live-strip {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      flex-wrap: wrap;
      padding: 0.85rem 1rem;
      color: var(--ink-muted);
      font-size: 0.86rem;
    }

    .live-strip strong {
      color: var(--ink);
      font-variant-numeric: tabular-nums;
    }

    .message {
      padding: 2.5rem 1.5rem;
      display: grid;
      justify-items: center;
      gap: 0.5rem;
      text-align: center;
    }

    .message.error {
      color: var(--avoid);
    }

    .empty-mark {
      font-size: 1.5rem;
      color: var(--gold);
      filter: drop-shadow(0 0 12px rgba(255, 176, 32, 0.5));
    }

    .alerts-list {
      display: grid;
      gap: 0.72rem;
    }

    .alert-row {
      position: relative;
      display: grid;
      grid-template-columns: 2.6rem minmax(12rem, 1.1fr) minmax(14rem, 1.35fr) auto minmax(7rem, 0.55fr) minmax(8rem, 0.55fr) minmax(5rem, auto);
      align-items: center;
      gap: 0.9rem;
      min-height: 5.85rem;
      padding: 0.95rem 1rem;
      overflow: hidden;
    }

    .card-accent {
      position: absolute;
      inset: 0 0 auto 0;
      height: 2px;
      background: linear-gradient(90deg, transparent, var(--gold), transparent);
      opacity: 0;
    }

    .alert-row:hover {
      transform: translateX(3px);
      border-color: var(--glass-border-strong);
      box-shadow: 0 0 0 1px rgba(255, 176, 32, 0.18);
    }

    .alert-row:hover .card-accent {
      opacity: 1;
    }

    .alert-row.new {
      border-color: rgba(255, 176, 32, 0.34);
      animation: arrive 520ms ease both;
    }

    .alert-row.new .card-accent {
      opacity: 1;
    }

    @keyframes arrive {
      from {
        transform: translateY(-10px);
        opacity: 0;
      }
      to {
        transform: translateY(0);
        opacity: 1;
      }
    }

    .row-index {
      color: var(--ink-dim);
      font-size: 0.75rem;
      font-variant-numeric: tabular-nums;
    }

    .token-cell {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      align-items: center;
      gap: 0.75rem;
      min-width: 0;
    }

    .token-avatar {
      display: grid;
      place-items: center;
      width: 2.6rem;
      height: 2.6rem;
      border-radius: 0.8rem;
      background: linear-gradient(150deg, rgba(255, 255, 255, 0.12), rgba(255, 255, 255, 0.03));
      border: 1px solid var(--glass-border);
      color: var(--gold-bright);
      font-weight: 500;
      font-size: 0.78rem;
    }

    .token-meta {
      display: grid;
      min-width: 0;
      line-height: 1.2;
    }

    .token-sym {
      font-size: 1.15rem;
      font-weight: 500;
    }

    .caller-cell {
      display: grid;
      gap: 0.16rem;
      min-width: 0;
      line-height: 1.25;
    }

    .caller-cell strong,
    .profile-link {
      font-size: 0.95rem;
      font-weight: 500;
    }

    .profile-link {
      color: var(--ink);
      min-width: 0;
    }

    .profile-link:hover,
    .quick-link:hover {
      color: var(--gold-bright);
    }

    .quick-links {
      display: flex;
      align-items: center;
      gap: 0.45rem;
      margin-top: 0.18rem;
    }

    .quick-link {
      display: inline-flex;
      align-items: center;
      min-height: 1.45rem;
      padding: 0.16rem 0.48rem;
      border-radius: 999px;
      border: 1px solid var(--glass-border);
      background: rgba(255, 255, 255, 0.035);
      color: var(--ink-muted);
      font-size: 0.68rem;
      font-weight: 500;
    }

    .field-label {
      color: var(--ink-dim);
      font-size: 0.66rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .verdict {
      justify-self: start;
      border-radius: 999px;
      padding: 0.28rem 0.6rem;
      font-size: 0.64rem;
      font-weight: 500;
      letter-spacing: 0.04em;
      white-space: nowrap;
      border: 1px solid transparent;
      background: rgba(139, 149, 181, 0.14);
      color: var(--neutral);
    }

    .verdict.super {
      background: rgba(255, 176, 32, 0.14);
      color: var(--gold-bright);
      border-color: rgba(255, 176, 32, 0.4);
      box-shadow: 0 0 18px -4px rgba(255, 176, 32, 0.45);
    }

    .verdict.good {
      background: rgba(52, 211, 158, 0.13);
      color: var(--good);
      border-color: rgba(52, 211, 158, 0.32);
    }

    .verdict.avoid {
      background: rgba(255, 93, 108, 0.13);
      color: var(--avoid);
      border-color: rgba(255, 93, 108, 0.32);
    }

    .new-badge {
      justify-self: end;
      border-radius: 999px;
      padding: 0.22rem 0.5rem;
      border: 1px solid rgba(255, 176, 32, 0.34);
      color: var(--gold-bright);
      font-size: 0.62rem;
      font-weight: 500;
      text-transform: uppercase;
      background: rgba(255, 176, 32, 0.1);
    }

    .perf {
      display: flex;
      align-items: baseline;
      gap: 0.6rem;
      justify-content: flex-end;
      padding: 0.52rem 0.72rem;
      border-radius: var(--radius-sm);
      background: rgba(52, 211, 158, 0.08);
      border: 1px solid rgba(52, 211, 158, 0.16);
    }

    .perf.negative {
      background: rgba(255, 93, 108, 0.08);
      border-color: rgba(255, 93, 108, 0.16);
    }

    .perf-value {
      font-size: 1.05rem;
      font-weight: 500;
      font-variant-numeric: tabular-nums;
      color: var(--good);
      letter-spacing: 0;
    }

    .perf.negative .perf-value {
      color: var(--avoid);
    }

    .perf-label {
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--ink-muted);
    }

    .stats {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 0.6rem;
      margin: 0;
    }

    .stats.compact {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .stats dt {
      color: var(--ink-dim);
      font-size: 0.68rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .stats dd {
      margin: 0.2rem 0 0;
      font-weight: 500;
      font-variant-numeric: tabular-nums;
    }

    .ellipsis {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      color: var(--ink-muted);
      font-size: 0.82rem;
    }

    .row-time {
      justify-content: flex-end;
      gap: 0.5rem;
      white-space: nowrap;
    }

    .skeleton {
      min-height: 5.85rem;
    }

    @media (max-width: 760px) {
      header {
        align-items: flex-start;
      }

      h1 {
        font-size: 2rem;
      }

      .alert-row {
        grid-template-columns: auto 1fr;
        align-items: start;
      }

      .row-index {
        grid-row: span 5;
        padding-top: 0.85rem;
      }

      .token-cell,
      .caller-cell,
      .verdict,
      .perf,
      .stats.compact,
      .row-time {
        grid-column: 2;
      }

      .perf {
        justify-content: flex-start;
      }

      .row-time {
        justify-content: flex-start;
      }
    }
  `
})
export class LiveAlertsPage implements OnInit, OnDestroy {
  private readonly alertsApi = inject(AlertsApi);
  private readonly healthApi = inject(HealthApi);
  readonly realtime = inject(SignalrService);

  readonly alerts = signal<AlertSignal[]>([]);
  readonly health = signal<HealthStatus | null>(null);
  readonly loading = signal(true);
  readonly refreshing = signal(false);
  readonly error = signal<string | null>(null);
  readonly lastUpdatedAt = signal<string | null>(null);
  readonly newAlertIds = signal<Set<string>>(new Set());
  readonly now = signal(Date.now());
  readonly newAlertCount = computed(() => this.newAlertIds().size);
  readonly skeletons = [0, 1, 2, 3, 4, 5];
  private tickerId: ReturnType<typeof window.setInterval> | null = null;
  private pollingId: ReturnType<typeof window.setInterval> | null = null;

  private readonly liveMessageEffect = effect(() => {
    const sequence = this.realtime.messageSequence();
    if (sequence === 0) {
      return;
    }

    const alert = coerceLiveAlertEvent(this.realtime.lastMessage());
    if (!alert) {
      return;
    }

    this.prependLiveAlert(alert);
  });

  ngOnInit(): void {
    this.realtime.connect();
    this.loadHealth();
    this.loadAlerts();
    this.tickerId = window.setInterval(() => this.now.set(Date.now()), 30_000);
    this.pollingId = window.setInterval(() => {
      this.loadAlerts({ forceRefresh: true, background: true });
    }, 45_000);
  }

  ngOnDestroy(): void {
    this.liveMessageEffect.destroy();
    if (this.tickerId) {
      window.clearInterval(this.tickerId);
    }
    if (this.pollingId) {
      window.clearInterval(this.pollingId);
    }
  }

  refreshAlerts(): void {
    this.alertsApi.clearCache();
    this.loadAlerts({ forceRefresh: true });
    this.newAlertIds.set(new Set());
  }

  private loadHealth(): void {
    this.healthApi.check().subscribe({
      next: (health) => this.health.set(health),
      error: () =>
        this.health.set({
          status: 'unreachable'
        })
    });
  }

  isNewAlert(alertId: string): boolean {
    return this.newAlertIds().has(alertId);
  }

  relativeTime(value: string): string {
    const now = this.now();
    const timestamp = new Date(value).getTime();
    if (!Number.isFinite(timestamp)) {
      return 'unknown';
    }

    const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
    if (seconds < 60) {
      return 'now';
    }

    const minutes = Math.round(seconds / 60);
    if (minutes < 60) {
      return `${minutes}m ago`;
    }

    const hours = Math.round(minutes / 60);
    if (hours < 24) {
      return `${hours}h ago`;
    }

    return `${Math.round(hours / 24)}d ago`;
  }

  primaryPostUrl(alert: AlertSignal): string | null {
    return alert.posts.find((post) => post.sourceUrl)?.sourceUrl ?? null;
  }

  profileUrl(alert: AlertSignal): string {
    return `https://x.com/${alert.callerHandle.replace(/^@/, '')}`;
  }

  private loadAlerts(options: { forceRefresh?: boolean; background?: boolean } = {}): void {
    const hasExistingAlerts = this.alerts().length > 0;
    this.loading.set(!hasExistingAlerts);
    this.refreshing.set(hasExistingAlerts && !options.background);
    this.error.set(null);

    this.alertsApi.listAlerts(options).subscribe({
      next: (alerts) => {
        if (hasExistingAlerts && options.forceRefresh) {
          const existingIds = new Set(this.alerts().map((alert) => alert.id));
          const incomingIds = alerts
            .filter((alert) => !existingIds.has(alert.id))
            .map((alert) => alert.id);
          if (incomingIds.length > 0) {
            this.newAlertIds.update((ids) => new Set([...incomingIds, ...ids]));
          }
        }

        this.alerts.set(alerts);
        this.lastUpdatedAt.set(new Date().toISOString());
        this.loading.set(false);
        this.refreshing.set(false);
      },
      error: (error: unknown) => {
        this.error.set(error instanceof Error ? error.message : 'Unable to load alerts');
        this.loading.set(false);
        this.refreshing.set(false);
      }
    });
  }

  private prependLiveAlert(alert: AlertSignal): void {
    this.alerts.update((alerts) => [alert, ...alerts.filter((item) => item.id !== alert.id)].slice(0, 24));
    this.alertsApi.prependCachedAlert(alert);
    this.newAlertIds.update((ids) => new Set([alert.id, ...ids]));
    this.lastUpdatedAt.set(new Date().toISOString());
  }
}
