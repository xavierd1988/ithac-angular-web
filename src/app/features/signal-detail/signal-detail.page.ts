import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { AlertsApi } from '../../data-access/alerts/alerts.api';
import { AlertSignal } from '../../data-access/alerts/alerts.types';

@Component({
  selector: 'ithac-signal-detail-page',
  imports: [DatePipe, DecimalPipe, RouterLink],
  template: `
    <main class="page detail">
      <a class="back" routerLink="/app/live">← Back to Live</a>

      @if (loading()) {
        <section class="panel message">Loading signal…</section>
      } @else if (error()) {
        <section class="panel message error">{{ error() }}</section>
      } @else if (alert(); as a) {
        <header class="panel hero">
          <div class="hero-id">
            <span class="token-avatar">{{ a.tokenSymbol.slice(0, 3) }}</span>
            <div class="hero-meta">
              <span
                class="verdict"
                [class.super]="a.verdict === 'SUPER TRADE'"
                [class.good]="a.verdict === 'GOOD TRADE'"
                [class.avoid]="a.verdict === 'AVOID'"
                >{{ a.verdict }}</span
              >
              <h1>{{ a.tokenSymbol }} <span class="muted">/ {{ a.tokenName }}</span></h1>
              <p class="muted summary">{{ a.summary }}</p>
            </div>
          </div>
          <div class="hero-stats">
            <div class="stat">
              <dt>Caller</dt>
              <dd class="ellipsis">
                <a
                  [href]="profileUrl(a)"
                  target="_blank"
                  rel="noopener noreferrer"
                  [attr.aria-label]="'Open X profile for ' + a.callerHandle"
                  >{{ a.callerHandle }}</a
                >
              </dd>
            </div>
            <div class="stat">
              <dt>Rank</dt>
              <dd>#{{ a.rank }}</dd>
            </div>
            <div class="stat">
              <dt>Win rate</dt>
              <dd>{{ a.winRate | number: '1.0-0' }}%</dd>
            </div>
          </div>
        </header>

        <section class="grid">
          <article class="panel block">
            <div class="block-head">
              <h2>TIMEX result</h2>
              <span class="muted small">{{ timexStatus() }}</span>
            </div>

            <div class="timex-result" [class.negative]="a.performancePercent < 0">
              {{ a.performancePercent >= 0 ? '+' : '' }}{{ a.performancePercent | number: '1.1-1' }}%
            </div>

            <div class="bar" role="img" aria-label="TIMEX performance magnitude">
              <span class="bar-fill" [class.neg]="!timexBar().positive" [style.width.%]="timexBar().width"></span>
            </div>

            @if (timexChart(); as chart) {
              <div class="chart-card" [class.negative]="!chart.positive">
                <svg viewBox="0 0 320 132" role="img" aria-label="TIMEX price path">
                  <polygon class="chart-area" [attr.points]="chart.areaPoints"></polygon>
                  <polyline class="chart-line" [attr.points]="chart.linePoints"></polyline>
                  <circle class="chart-dot start" [attr.cx]="chart.startDot.x" [attr.cy]="chart.startDot.y" r="3"></circle>
                  <circle class="chart-dot end" [attr.cx]="chart.endDot.x" [attr.cy]="chart.endDot.y" r="4"></circle>
                </svg>

                <div class="chart-meta">
                  <span>{{ chart.start.at | date: 'shortTime' }}</span>
                  <strong [class.negative]="!chart.positive">
                    {{ chart.end.changePercent >= 0 ? '+' : ''
                    }}{{ chart.end.changePercent | number: '1.1-1' }}%
                  </strong>
                  <span>{{ chart.end.at | date: 'shortTime' }}</span>
                </div>
              </div>
            } @else {
              <p class="muted tiny">Price path will appear when TIMEX samples are available.</p>
            }

            <p class="muted tiny">Price move observed after the call, over the TIMEX window.</p>
          </article>

          <article class="panel block">
            <div class="block-head">
              <h2>Related posts</h2>
              <span class="muted small">{{ a.posts.length }}</span>
            </div>
            <div class="posts">
              @for (post of a.posts; track post.id) {
                <section class="post">
                  <div class="post-head">
                    <a
                      [href]="profileUrlFromHandle(post.handle)"
                      target="_blank"
                      rel="noopener noreferrer"
                      [attr.aria-label]="'Open X profile for ' + post.handle"
                      >{{ post.handle }}</a
                    >
                    <time [dateTime]="post.postedAt">{{ post.postedAt | date: 'short' }}</time>
                  </div>
                  <p>{{ post.text }}</p>
                  @if (post.sourceUrl) {
                    <a class="post-link" [href]="post.sourceUrl" target="_blank" rel="noopener noreferrer">
                      Open original post
                    </a>
                  }
                </section>
              } @empty {
                <p class="muted">No linked posts for this signal.</p>
              }
            </div>
          </article>
        </section>
      }
    </main>
  `,
  styles: `
    .detail {
      display: grid;
      gap: 1.25rem;
    }

    .back {
      justify-self: start;
      color: var(--ink-muted);
      font-size: 0.88rem;
      font-weight: 500;
      padding: 0.4rem 0.75rem;
      border-radius: 999px;
      border: 1px solid var(--glass-border);
      background: var(--glass);
    }

    .hero {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(15rem, 22rem);
      gap: 1.5rem;
      padding: 1.5rem;
    }

    .hero-id {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 1rem;
      min-width: 0;
    }

    .token-avatar {
      display: grid;
      place-items: center;
      width: 3.25rem;
      height: 3.25rem;
      border-radius: 1rem;
      background: linear-gradient(150deg, rgba(255, 255, 255, 0.14), rgba(255, 255, 255, 0.03));
      border: 1px solid var(--glass-border);
      color: var(--gold-bright);
      font-weight: 500;
      font-size: 0.95rem;
    }

    .hero-meta {
      display: grid;
      gap: 0.45rem;
      min-width: 0;
    }

    h1 {
      margin: 0;
      font-size: 1.9rem;
      font-weight: 500;
      letter-spacing: 0;
    }

    h1 .muted {
      font-weight: 500;
      font-size: 1.1rem;
    }

    h2 {
      margin: 0;
      font-size: 1rem;
      letter-spacing: 0.01em;
    }

    .summary {
      margin: 0;
      font-size: 0.92rem;
    }

    .verdict {
      justify-self: start;
      border-radius: 999px;
      padding: 0.28rem 0.65rem;
      font-size: 0.66rem;
      font-weight: 500;
      letter-spacing: 0.04em;
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

    .hero-stats {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 0.75rem;
      align-content: start;
    }

    .stat {
      padding: 0.7rem 0.75rem;
      border-radius: var(--radius-sm);
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid var(--glass-border);
    }

    .stat dt {
      color: var(--ink-dim);
      font-size: 0.68rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .stat dd {
      margin: 0.25rem 0 0;
      font-weight: 500;
      font-variant-numeric: tabular-nums;
    }

    .stat a,
    .post-head a,
    .post-link {
      color: var(--ink);
      font-weight: 500;
    }

    .stat a:hover,
    .post-head a:hover,
    .post-link:hover {
      color: var(--gold-bright);
    }

    .grid {
      display: grid;
      grid-template-columns: 0.9fr 1.1fr;
      gap: 1.25rem;
    }

    .block {
      display: grid;
      align-content: start;
      gap: 1rem;
      padding: 1.5rem;
    }

    .block-head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 0.75rem;
    }

    .small {
      font-size: 0.78rem;
    }

    .tiny {
      margin: 0;
      font-size: 0.78rem;
    }

    .timex-result {
      font-size: 3rem;
      font-weight: 500;
      font-variant-numeric: tabular-nums;
      letter-spacing: 0;
      color: var(--good);
    }

    .timex-result.negative {
      color: var(--avoid);
    }

    .bar {
      position: relative;
      height: 0.6rem;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.06);
      overflow: hidden;
    }

    .bar-fill {
      position: absolute;
      inset: 0 auto 0 0;
      min-width: 0.6rem;
      border-radius: 999px;
      background: linear-gradient(90deg, var(--good), #7ef0c0);
      box-shadow: 0 0 16px rgba(52, 211, 158, 0.45);
      transition: width 320ms ease;
    }

    .bar-fill.neg {
      background: linear-gradient(90deg, var(--avoid), #ff95a0);
      box-shadow: 0 0 16px rgba(255, 93, 108, 0.45);
    }

    .chart-card {
      --chart-color: var(--good);
      --chart-fill: rgba(52, 211, 158, 0.12);
      display: grid;
      gap: 0.55rem;
      padding: 0.75rem;
      border: 1px solid var(--glass-border);
      border-radius: var(--radius-sm);
      background: rgba(255, 255, 255, 0.03);
    }

    .chart-card.negative {
      --chart-color: var(--avoid);
      --chart-fill: rgba(255, 93, 108, 0.12);
    }

    svg {
      width: 100%;
      height: 9rem;
    }

    .chart-area {
      fill: var(--chart-fill);
    }

    .chart-line {
      fill: none;
      stroke: var(--chart-color);
      stroke-width: 3;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .chart-dot {
      fill: var(--panel);
      stroke: var(--chart-color);
      stroke-width: 2;
    }

    .chart-dot.end {
      fill: var(--chart-color);
    }

    .chart-meta {
      display: grid;
      grid-template-columns: 1fr auto 1fr;
      align-items: center;
      gap: 0.75rem;
      color: var(--ink-dim);
      font-size: 0.75rem;
      font-variant-numeric: tabular-nums;
    }

    .chart-meta strong {
      color: var(--good);
      font-size: 0.88rem;
    }

    .chart-meta strong.negative {
      color: var(--avoid);
    }

    .chart-meta span:last-child {
      text-align: right;
    }

    .posts {
      display: grid;
      gap: 0.75rem;
      margin: 0;
    }

    .post {
      border-radius: var(--radius-sm);
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid var(--glass-border);
      padding: 0.85rem 0.95rem;
    }

    .post-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      margin-bottom: 0.35rem;
    }

    .post p {
      margin: 0;
      color: var(--ink-muted);
      font-size: 0.92rem;
    }

    .post-link {
      display: inline-flex;
      margin-top: 0.55rem;
      font-size: 0.82rem;
    }

    time {
      color: var(--ink-dim);
      font-size: 0.78rem;
    }

    .ellipsis {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .message {
      padding: 2rem 1.5rem;
      text-align: center;
    }

    .message.error {
      color: var(--avoid);
    }

    @media (max-width: 880px) {
      .hero,
      .grid {
        grid-template-columns: 1fr;
      }
    }
  `
})
export class SignalDetailPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly alertsApi = inject(AlertsApi);

  readonly alert = signal<AlertSignal | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  readonly timexBar = computed(() => {
    const a = this.alert();
    const perf = a?.performancePercent ?? 0;
    return { width: Math.min(Math.abs(perf) * 2, 100), positive: perf >= 0 };
  });

  readonly timexStatus = computed(() => this.alert()?.timex?.[0]?.label ?? 'TIMEX');

  readonly timexChart = computed(() => {
    const points = this.alert()?.pricePoints ?? [];
    if (points.length < 2) {
      return null;
    }

    const width = 320;
    const height = 132;
    const paddingX = 12;
    const paddingY = 16;
    const usableWidth = width - paddingX * 2;
    const usableHeight = height - paddingY * 2;
    const changes = points.map((point) => point.changePercent);
    let min = Math.min(...changes);
    let max = Math.max(...changes);

    if (min === max) {
      min -= 1;
      max += 1;
    }

    const coordinates = points.map((point, index) => ({
      x: paddingX + (index / (points.length - 1)) * usableWidth,
      y: paddingY + ((max - point.changePercent) / (max - min)) * usableHeight
    }));
    const linePoints = coordinates.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
    const startDot = coordinates[0];
    const endDot = coordinates[coordinates.length - 1];
    const baselineY = height - paddingY;

    return {
      linePoints,
      areaPoints: `${paddingX},${baselineY} ${linePoints} ${width - paddingX},${baselineY}`,
      start: points[0],
      end: points[points.length - 1],
      startDot,
      endDot,
      positive: points[points.length - 1].changePercent >= 0
    };
  });

  ngOnInit(): void {
    const alertId = this.route.snapshot.paramMap.get('alertId');

    if (!alertId) {
      this.error.set('Missing alert id');
      this.loading.set(false);
      return;
    }

    this.alertsApi.getAlert(alertId).subscribe({
      next: (alert) => {
        this.alert.set(alert);
        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.error.set(error instanceof Error ? error.message : 'Unable to load signal');
        this.loading.set(false);
      }
    });
  }

  profileUrl(alert: AlertSignal): string {
    return this.profileUrlFromHandle(alert.callerHandle);
  }

  profileUrlFromHandle(handle: string): string {
    return `https://x.com/${handle.replace(/^@/, '')}`;
  }
}
