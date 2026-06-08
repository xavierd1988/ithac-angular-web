import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { InfluencersApi } from '../../data-access/influencers/influencers.api';
import { InfluencerProfile } from '../../data-access/influencers/influencers.types';

@Component({
  selector: 'ithac-influencer-detail-page',
  imports: [DatePipe, DecimalPipe, RouterLink],
  template: `
    <main class="page influencer-detail">
      <a class="back" routerLink="/app/influencers">← Back to influencers</a>

      @if (loading()) {
        <section class="panel message">Loading influencer…</section>
      } @else if (error()) {
        <section class="panel message error">{{ error() }}</section>
      } @else if (profile(); as p) {
        <header class="panel hero">
          <div class="hero-id">
            <span class="avatar">{{ p.displayName.slice(0, 2) }}</span>
            <div class="hero-meta">
              <span class="rank" [class.top]="p.rank <= 3">Rank #{{ p.rank }}</span>
              <h1>{{ p.displayName }}</h1>
              <p class="muted">{{ p.handle }}</p>
            </div>
          </div>
          <div class="hero-stats">
            <div class="stat">
              <dt>Win rate</dt>
              <dd class="gold">{{ p.winRate | number: '1.0-0' }}%</dd>
            </div>
            <div class="stat">
              <dt>Avg TIMEX</dt>
              <dd [class.negative]="p.averagePerformancePercent < 0">
                {{ p.averagePerformancePercent >= 0 ? '+' : ''
                }}{{ p.averagePerformancePercent | number: '1.1-1' }}%
              </dd>
            </div>
            <div class="stat">
              <dt>Calls</dt>
              <dd>{{ p.callsTracked }}</dd>
            </div>
          </div>
        </header>

        <section class="grid">
          <article class="panel block">
            <h2>Specialties</h2>
            @if (p.specialties.length) {
              <div class="chips">
                @for (specialty of p.specialties; track specialty) {
                  <span class="chip">{{ specialty }}</span>
                }
              </div>
            } @else {
              <p class="muted">No specialties tagged.</p>
            }

            @if (sparkline().length) {
              <div class="spark-wrap">
                <span class="muted small">Recent calls performance</span>
                <div class="spark">
                  @for (bar of sparkline(); track $index) {
                    <span [class.neg]="!bar.positive" [style.height.%]="bar.heightPercent"></span>
                  }
                </div>
              </div>
            }
          </article>

          <article class="panel block">
            <h2>Latest signals</h2>
            <div class="signals">
              @for (sig of p.latestSignals; track sig.tokenSymbol + sig.calledAt) {
                <section class="sig">
                  <span class="sig-token">{{ sig.tokenSymbol }}</span>
                  <span
                    class="verdict"
                    [class.super]="sig.verdict === 'SUPER TRADE'"
                    [class.good]="sig.verdict === 'GOOD TRADE'"
                    [class.avoid]="sig.verdict === 'AVOID'"
                    >{{ sig.verdict }}</span
                  >
                  <strong class="sig-perf" [class.negative]="sig.performancePercent < 0">
                    {{ sig.performancePercent >= 0 ? '+' : ''
                    }}{{ sig.performancePercent | number: '1.1-1' }}%
                  </strong>
                  <time [dateTime]="sig.calledAt">{{ sig.calledAt | date: 'short' }}</time>
                </section>
              } @empty {
                <p class="muted">No recent signals.</p>
              }
            </div>
          </article>
        </section>
      }
    </main>
  `,
  styles: `
    .influencer-detail {
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
      transition:
        color 140ms ease,
        border-color 140ms ease;
    }

    .back:hover {
      color: var(--ink);
      border-color: var(--glass-border-strong);
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

    .avatar {
      display: grid;
      place-items: center;
      width: 3.25rem;
      height: 3.25rem;
      border-radius: 1rem;
      background: linear-gradient(150deg, rgba(255, 255, 255, 0.14), rgba(255, 255, 255, 0.03));
      border: 1px solid var(--glass-border);
      color: var(--gold-bright);
      font-weight: 500;
      font-size: 1.05rem;
      text-transform: uppercase;
    }

    .hero-meta {
      display: grid;
      gap: 0.4rem;
      min-width: 0;
    }

    h1 {
      margin: 0;
      font-size: 1.9rem;
      font-weight: 500;
    }

    h2 {
      margin: 0;
      font-size: 1rem;
    }

    .rank {
      justify-self: start;
      font-size: 0.72rem;
      font-weight: 500;
      color: var(--ink-muted);
      padding: 0.22rem 0.55rem;
      border-radius: 999px;
      border: 1px solid var(--glass-border);
    }

    .rank.top {
      color: var(--gold-bright);
      border-color: rgba(255, 176, 32, 0.4);
      background: rgba(255, 176, 32, 0.1);
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

    .stat dd.gold {
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

    .small {
      font-size: 0.78rem;
    }

    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
    }

    .chip {
      border-radius: 999px;
      padding: 0.3rem 0.7rem;
      font-size: 0.78rem;
      font-weight: 500;
      color: var(--gold-bright);
      background: rgba(255, 176, 32, 0.1);
      border: 1px solid rgba(255, 176, 32, 0.25);
    }

    .spark-wrap {
      display: grid;
      gap: 0.5rem;
    }

    .spark {
      display: flex;
      align-items: flex-end;
      gap: 0.25rem;
      height: 3.5rem;
      padding: 0.5rem;
      border-radius: var(--radius-sm);
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid var(--glass-border);
    }

    .spark span {
      flex: 1;
      min-height: 0.35rem;
      border-radius: 999px 999px 2px 2px;
      background: linear-gradient(180deg, var(--good), rgba(52, 211, 158, 0.35));
    }

    .spark span.neg {
      background: linear-gradient(180deg, var(--avoid), rgba(255, 93, 108, 0.35));
    }

    .signals {
      display: grid;
      gap: 0.6rem;
    }

    .sig {
      display: grid;
      grid-template-columns: 4rem 1fr auto auto;
      gap: 0.75rem;
      align-items: center;
      border-radius: var(--radius-sm);
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid var(--glass-border);
      padding: 0.7rem 0.85rem;
    }

    .sig-token {
      font-weight: 500;
    }

    .verdict {
      justify-self: start;
      border-radius: 999px;
      padding: 0.22rem 0.55rem;
      font-size: 0.6rem;
      font-weight: 500;
      letter-spacing: 0.03em;
      border: 1px solid transparent;
      background: rgba(139, 149, 181, 0.14);
      color: var(--neutral);
    }

    .verdict.super {
      background: rgba(255, 176, 32, 0.14);
      color: var(--gold-bright);
      border-color: rgba(255, 176, 32, 0.4);
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

    .sig-perf {
      font-variant-numeric: tabular-nums;
      color: var(--good);
    }

    .sig-perf.negative {
      color: var(--avoid);
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

    .negative {
      color: var(--avoid);
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

      .sig {
        grid-template-columns: 1fr auto;
      }
    }
  `
})
export class InfluencerDetailPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly influencersApi = inject(InfluencersApi);

  readonly profile = signal<InfluencerProfile | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  readonly sparkline = computed(() => {
    const signals = this.profile()?.latestSignals ?? [];
    if (signals.length < 2) {
      return [] as { heightPercent: number; positive: boolean }[];
    }
    const values = signals.map((s) => s.performancePercent);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    return signals.map((s) => ({
      heightPercent: 16 + ((s.performancePercent - min) / range) * 84,
      positive: s.performancePercent >= 0
    }));
  });

  ngOnInit(): void {
    const influencerId = this.route.snapshot.paramMap.get('influencerId');

    if (!influencerId) {
      this.error.set('Missing influencer id');
      this.loading.set(false);
      return;
    }

    this.influencersApi.getInfluencer(influencerId).subscribe({
      next: (profile) => {
        this.profile.set(profile);
        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.error.set(error instanceof Error ? error.message : 'Unable to load influencer');
        this.loading.set(false);
      }
    });
  }
}
