import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';

import { InfluencersApi } from '../../data-access/influencers/influencers.api';
import { InfluencerProfile } from '../../data-access/influencers/influencers.types';

@Component({
  selector: 'ithac-influencer-list-page',
  imports: [DatePipe, DecimalPipe],
  template: `
    <main class="page influencers">
      <header>
        <div class="title">
          <span class="eyebrow">Influencer reputation</span>
          <h1>Reputation ranking</h1>
          <p class="muted sub">The accounts with the strongest measured signal history.</p>
        </div>
        <div class="header-metrics">
          <span class="status-pill brand">{{ profiles().length }} ranked</span>
          <span class="status-pill dot ok">{{ totalCalls() }} calls evaluated</span>
        </div>
      </header>

      @if (loading()) {
        <section class="ranking-list" aria-hidden="true">
          @for (i of skeletons; track i) {
            <div class="panel ranking-row skeleton"></div>
          }
        </section>
      } @else if (error()) {
        <section class="panel message error">{{ error() }}</section>
      } @else if (profiles().length === 0) {
        <section class="panel message empty">
          <span class="empty-mark">◆</span>
          <strong>No influencers tracked yet</strong>
        </section>
      } @else {
        <section class="ranking-list" aria-label="Influencer reputation ranking">
          @for (profile of profiles(); track profile.id) {
            <article class="panel ranking-row" [class.top]="profile.rank <= 3">
              <span class="card-accent" aria-hidden="true"></span>

              <span class="rank" [class.medal]="profile.rank <= 3">#{{ profile.rank }}</span>

              <div class="identity">
                @if (profile.profileImageUrl) {
                  <img class="avatar" [src]="profile.profileImageUrl" [alt]="profile.displayName" />
                } @else {
                  <span class="avatar fallback">{{ profile.displayName.slice(0, 2) }}</span>
                }
                <span class="who">
                  <strong class="ellipsis">{{ profile.displayName }}</strong>
                  <small class="muted ellipsis">{{ profile.handle }}</small>
                </span>
              </div>

              <div class="score">
                <strong [class.negative]="profile.totalScore < 0">
                  {{ profile.totalScore | number: '1.0-2' }}
                </strong>
                <span>score</span>
              </div>

              <div class="score avg" [class.negative]="profile.averagePerformancePercent < 0">
                <strong>
                  {{ profile.averagePerformancePercent >= 0 ? '+' : ''
                  }}{{ profile.averagePerformancePercent | number: '1.2-2' }}%
                </strong>
                <span>avg TIMEX</span>
              </div>

              <dl class="call-mix">
                <div>
                  <dt>Evaluated</dt>
                  <dd>{{ profile.callsTracked }}</dd>
                </div>
                <div>
                  <dt>Positive</dt>
                  <dd>{{ profile.positiveCalls }}</dd>
                </div>
                <div>
                  <dt>Neutral</dt>
                  <dd>{{ profile.neutralCalls }}</dd>
                </div>
              </dl>

              <div class="updated">
                <span>Updated</span>
                <time [dateTime]="profile.lastUpdated ?? ''">
                  {{ profile.lastUpdated ? (profile.lastUpdated | date: 'MMM d, h:mm a') : 'Pending' }}
                </time>
              </div>
            </article>
          }
        </section>
      }
    </main>
  `,
  styles: `
    .influencers {
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

    .header-metrics {
      display: flex;
      flex-wrap: wrap;
      gap: 0.55rem;
      justify-content: flex-end;
    }

    .eyebrow {
      color: var(--gold);
      font-size: 0.76rem;
      font-weight: 500;
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }

    h1 {
      margin: 0.45rem 0 0.25rem;
      font-size: 2.5rem;
      font-weight: 500;
    }

    .sub {
      margin: 0;
      font-size: 0.95rem;
    }

    .ranking-list {
      display: grid;
      gap: 0.72rem;
    }

    .ranking-row {
      position: relative;
      display: grid;
      grid-template-columns:
        4.2rem minmax(15rem, 1.45fr) minmax(7rem, 0.55fr) minmax(7rem, 0.55fr)
        minmax(14rem, 1fr) minmax(8rem, 0.65fr);
      align-items: center;
      gap: 1rem;
      min-height: 5.9rem;
      padding: 0.95rem 1rem;
      overflow: hidden;
      transition:
        transform 180ms ease,
        border-color 180ms ease,
        box-shadow 180ms ease;
    }

    .card-accent {
      position: absolute;
      inset: 0 0 auto 0;
      height: 2px;
      background: linear-gradient(90deg, transparent, var(--gold), transparent);
      opacity: 0;
      transition: opacity 180ms ease;
    }

    .ranking-row:hover {
      transform: translateX(3px);
      border-color: var(--glass-border-strong);
      box-shadow:
        0 28px 50px -28px rgba(0, 0, 0, 0.95),
        0 0 0 1px rgba(255, 176, 32, 0.18);
    }

    .ranking-row:hover .card-accent,
    .ranking-row.top .card-accent {
      opacity: 1;
    }

    .rank {
      justify-self: start;
      border: 1px solid var(--glass-border);
      border-radius: 999px;
      padding: 0.28rem 0.62rem;
      color: var(--ink-muted);
      font-size: 0.88rem;
      font-weight: 500;
      font-variant-numeric: tabular-nums;
    }

    .rank.medal {
      border-color: rgba(255, 176, 32, 0.4);
      background: rgba(255, 176, 32, 0.1);
      color: var(--gold-bright);
    }

    .identity {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      align-items: center;
      gap: 0.75rem;
      min-width: 0;
    }

    .avatar {
      display: grid;
      width: 2.7rem;
      height: 2.7rem;
      place-items: center;
      border: 1px solid var(--glass-border);
      border-radius: 0.8rem;
      background: linear-gradient(150deg, rgba(255, 255, 255, 0.12), rgba(255, 255, 255, 0.03));
      color: var(--gold-bright);
      font-size: 0.8rem;
      font-weight: 500;
      object-fit: cover;
      text-transform: uppercase;
    }

    .who {
      display: grid;
      min-width: 0;
      line-height: 1.2;
    }

    .who strong {
      font-size: 1.05rem;
      font-weight: 500;
    }

    .score {
      display: grid;
      gap: 0.12rem;
      font-variant-numeric: tabular-nums;
    }

    .score strong {
      color: var(--gold-bright);
      font-size: 1.05rem;
      font-weight: 500;
    }

    .score.avg strong {
      color: var(--good);
    }

    .score span,
    .updated span {
      color: var(--ink-dim);
      font-size: 0.72rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    dl {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 0.6rem;
      margin: 0;
    }

    dt {
      color: var(--ink-dim);
      font-size: 0.68rem;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }

    dd {
      margin: 0.2rem 0 0;
      font-weight: 500;
      font-variant-numeric: tabular-nums;
    }

    .negative {
      color: var(--avoid) !important;
    }

    .updated {
      display: grid;
      gap: 0.12rem;
      justify-items: end;
      color: var(--ink-muted);
      font-size: 0.82rem;
      white-space: nowrap;
    }

    .ellipsis {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .message {
      display: grid;
      justify-items: center;
      gap: 0.5rem;
      padding: 2.5rem 1.5rem;
      text-align: center;
    }

    .message.error {
      color: var(--avoid);
    }

    .empty-mark {
      color: var(--gold);
      font-size: 1.5rem;
      filter: drop-shadow(0 0 12px rgba(255, 176, 32, 0.5));
    }

    .skeleton {
      position: relative;
      min-height: 5.9rem;
      overflow: hidden;
    }

    .skeleton::after {
      content: "";
      position: absolute;
      inset: 0;
      background: linear-gradient(
        100deg,
        transparent 20%,
        rgba(255, 255, 255, 0.05) 50%,
        transparent 80%
      );
      transform: translateX(-100%);
      animation: shimmer 1.4s infinite;
    }

    @keyframes shimmer {
      to {
        transform: translateX(100%);
      }
    }

    @media (max-width: 980px) {
      .ranking-row {
        grid-template-columns: auto 1fr;
        align-items: start;
      }

      .rank {
        grid-row: span 5;
      }

      .identity,
      .score,
      .call-mix,
      .updated {
        grid-column: 2;
      }

      .updated {
        justify-items: start;
      }
    }

    @media (max-width: 760px) {
      h1 {
        font-size: 2rem;
      }
    }
  `
})
export class InfluencerListPage implements OnInit {
  private readonly influencersApi = inject(InfluencersApi);

  readonly profiles = signal<InfluencerProfile[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly skeletons = [0, 1, 2, 3, 4, 5, 6, 7];
  readonly totalCalls = computed(() =>
    this.profiles().reduce((sum, profile) => sum + profile.callsTracked, 0)
  );

  ngOnInit(): void {
    this.influencersApi.listInfluencers().subscribe({
      next: (profiles) => {
        this.profiles.set(profiles);
        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.error.set(error instanceof Error ? error.message : 'Unable to load influencers');
        this.loading.set(false);
      }
    });
  }
}
