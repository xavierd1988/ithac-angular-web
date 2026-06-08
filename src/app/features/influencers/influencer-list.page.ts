import { DecimalPipe } from '@angular/common';
import { Component, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { InfluencersApi } from '../../data-access/influencers/influencers.api';
import { InfluencerProfile } from '../../data-access/influencers/influencers.types';

@Component({
  selector: 'ithac-influencer-list-page',
  imports: [DecimalPipe, RouterLink],
  template: `
    <main class="page influencers">
      <header>
        <div class="title">
          <span class="eyebrow">Reputation</span>
          <h1>Influencers</h1>
          <p class="muted sub">Ranked by ITHAC reputation — win rate × performance.</p>
        </div>
        <span class="status-pill brand">{{ profiles().length }} tracked</span>
      </header>

      @if (loading()) {
        <section class="grid" aria-hidden="true">
          @for (i of skeletons; track i) {
            <div class="panel profile-card skeleton"></div>
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
        <section class="grid" aria-label="Influencer leaderboard">
          @for (profile of profiles(); track profile.id) {
            <a class="panel profile-card" [routerLink]="['/app/influencers', profile.id]">
              <span class="card-accent" aria-hidden="true"></span>

              <div class="topline">
                <span class="avatar">{{ profile.displayName.slice(0, 2) }}</span>
                <span class="who">
                  <strong class="ellipsis">{{ profile.displayName }}</strong>
                  <small class="muted ellipsis">{{ profile.handle }}</small>
                </span>
                <span class="rank" [class.top]="profile.rank <= 3">#{{ profile.rank }}</span>
              </div>

              <div class="winrate">
                <span class="big">{{ profile.winRate | number: '1.0-0' }}%</span>
                <span class="lbl">win rate</span>
              </div>

              <dl>
                <div>
                  <dt>Avg TIMEX</dt>
                  <dd [class.negative]="profile.averagePerformancePercent < 0">
                    {{ profile.averagePerformancePercent >= 0 ? '+' : ''
                    }}{{ profile.averagePerformancePercent | number: '1.1-1' }}%
                  </dd>
                </div>
                <div>
                  <dt>Calls</dt>
                  <dd>{{ profile.callsTracked }}</dd>
                </div>
              </dl>
            </a>
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

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(18rem, 1fr));
      gap: 1rem;
    }

    .profile-card {
      position: relative;
      display: grid;
      align-content: start;
      gap: 1rem;
      padding: 1.25rem;
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

    .profile-card:hover {
      transform: translateY(-3px);
      border-color: var(--glass-border-strong);
      box-shadow:
        0 28px 50px -28px rgba(0, 0, 0, 0.95),
        0 0 0 1px rgba(255, 176, 32, 0.18);
    }

    .profile-card:hover .card-accent {
      opacity: 1;
    }

    .topline {
      display: grid;
      grid-template-columns: auto 1fr auto;
      align-items: center;
      gap: 0.75rem;
    }

    .avatar {
      display: grid;
      place-items: center;
      width: 2.6rem;
      height: 2.6rem;
      border-radius: 0.8rem;
      background: linear-gradient(150deg, rgba(255, 255, 255, 0.12), rgba(255, 255, 255, 0.03));
      border: 1px solid var(--glass-border);
      color: var(--gold-bright);
      font-weight: 500;
      font-size: 0.8rem;
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

    .rank {
      font-size: 0.78rem;
      font-weight: 500;
      color: var(--ink-muted);
      font-variant-numeric: tabular-nums;
      padding: 0.2rem 0.5rem;
      border-radius: 999px;
      border: 1px solid var(--glass-border);
    }

    .rank.top {
      color: var(--gold-bright);
      border-color: rgba(255, 176, 32, 0.4);
      background: rgba(255, 176, 32, 0.1);
    }

    .winrate {
      display: flex;
      align-items: baseline;
      gap: 0.5rem;
    }

    .winrate .big {
      font-size: 2rem;
      font-weight: 500;
      font-variant-numeric: tabular-nums;
      color: var(--gold-bright);
      letter-spacing: -0.01em;
    }

    .winrate .lbl {
      font-size: 0.72rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--ink-muted);
    }

    dl {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 0.6rem;
      margin: 0;
    }

    dt {
      color: var(--ink-dim);
      font-size: 0.68rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    dd {
      margin: 0.2rem 0 0;
      font-weight: 500;
      font-variant-numeric: tabular-nums;
    }

    .negative {
      color: var(--avoid);
    }

    .ellipsis {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
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

    .skeleton {
      min-height: 12rem;
      position: relative;
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
  `
})
export class InfluencerListPage implements OnInit {
  private readonly influencersApi = inject(InfluencersApi);

  readonly profiles = signal<InfluencerProfile[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly skeletons = [0, 1, 2, 3, 4, 5];

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
