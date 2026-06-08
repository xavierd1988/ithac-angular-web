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
          <strong>{{ alerts().length }}</strong>
          active signals
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
        <section class="alerts-grid" aria-hidden="true">
          @for (i of skeletons; track i) {
            <div class="alert-card panel skeleton"></div>
          }
        </section>
      } @else if (alerts().length === 0) {
        <section class="panel message empty">
          <span class="empty-mark">◆</span>
          <strong>No active signals right now</strong>
          <span class="muted">New alerts appear here as influencers move.</span>
        </section>
      } @else {
        <section class="alerts-grid" aria-label="Live alert feed">
          @for (alert of alerts(); track alert.id) {
            <a class="alert-card panel" [class.new]="isNewAlert(alert.id)" [routerLink]="['/app/alerts', alert.id]">
              <span class="card-accent" aria-hidden="true"></span>

              <div class="card-head">
                <span class="token-avatar">{{ alert.tokenSymbol.slice(0, 3) }}</span>
                <span class="token-meta">
                  <strong class="token-sym">{{ alert.tokenSymbol }}</strong>
                  <small class="muted ellipsis">{{ alert.tokenName }}</small>
                </span>
                <span
                  class="verdict"
                  [class.super]="alert.verdict === 'SUPER TRADE'"
                  [class.good]="alert.verdict === 'GOOD TRADE'"
                  [class.avoid]="alert.verdict === 'AVOID'"
                  >{{ alert.verdict }}</span
                >
                @if (isNewAlert(alert.id)) {
                  <span class="new-badge">New</span>
                }
              </div>

              <div class="perf" [class.negative]="alert.performancePercent < 0">
                <span class="perf-value"
                  >{{ alert.performancePercent >= 0 ? '+' : ''
                  }}{{ alert.performancePercent | number: '1.1-1' }}%</span
                >
                <span class="perf-label">TIMEX move</span>
              </div>

              <dl class="stats">
                <div>
                  <dt>Caller</dt>
                  <dd class="ellipsis">{{ alert.callerHandle }}</dd>
                </div>
                <div>
                  <dt>Rank</dt>
                  <dd>#{{ alert.rank }}</dd>
                </div>
                <div>
                  <dt>Win rate</dt>
                  <dd>{{ alert.winRate | number: '1.0-0' }}%</dd>
                </div>
              </dl>

              <footer>
                <span>{{ alert.mentionCount }} mentions</span>
                <time [dateTime]="alert.createdAt" [title]="(alert.createdAt | date: 'medium') ?? ''">
                  {{ relativeTime(alert.createdAt) }}
                </time>
              </footer>
            </a>
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

    .alerts-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(18.5rem, 1fr));
      gap: 1.1rem;
    }

    .alert-card {
      position: relative;
      display: grid;
      align-content: start;
      gap: 1rem;
      padding: 1.25rem;
      overflow: hidden;
    }

    .card-accent {
      position: absolute;
      inset: 0 0 auto 0;
      height: 2px;
      background: linear-gradient(90deg, transparent, var(--gold), transparent);
      opacity: 0;
    }

    .alert-card:hover {
      transform: translateY(-3px);
      border-color: var(--glass-border-strong);
      box-shadow: 0 0 0 1px rgba(255, 176, 32, 0.18);
    }

    .alert-card:hover .card-accent {
      opacity: 1;
    }

    .alert-card.new {
      border-color: rgba(255, 176, 32, 0.34);
      animation: arrive 520ms ease both;
    }

    .alert-card.new .card-accent {
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

    .card-head {
      display: grid;
      grid-template-columns: auto 1fr auto auto;
      align-items: center;
      gap: 0.75rem;
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

    .verdict {
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
      padding: 0.65rem 0.85rem;
      border-radius: var(--radius-sm);
      background: rgba(52, 211, 158, 0.08);
      border: 1px solid rgba(52, 211, 158, 0.16);
    }

    .perf.negative {
      background: rgba(255, 93, 108, 0.08);
      border-color: rgba(255, 93, 108, 0.16);
    }

    .perf-value {
      font-size: 1.5rem;
      font-weight: 500;
      font-variant-numeric: tabular-nums;
      color: var(--good);
      letter-spacing: -0.01em;
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
      padding-top: 0.85rem;
      border-top: 1px solid rgba(255, 255, 255, 0.06);
      color: var(--ink-muted);
      font-size: 0.82rem;
    }

    .skeleton {
      min-height: 15rem;
    }

    @media (max-width: 760px) {
      header {
        align-items: flex-start;
      }

      h1 {
        font-size: 2rem;
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
  }

  ngOnDestroy(): void {
    this.liveMessageEffect.destroy();
    if (this.tickerId) {
      window.clearInterval(this.tickerId);
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

  private loadAlerts(options: { forceRefresh?: boolean } = {}): void {
    const hasExistingAlerts = this.alerts().length > 0;
    this.loading.set(!hasExistingAlerts);
    this.refreshing.set(hasExistingAlerts);
    this.error.set(null);

    this.alertsApi.listAlerts(options).subscribe({
      next: (alerts) => {
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
