import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { CoinsApi } from '../../data-access/coins/coins.api';
import { CoinSignalSummary } from '../../data-access/coins/coins.types';

@Component({
  selector: 'ithac-coin-list-page',
  imports: [DatePipe, DecimalPipe, RouterLink],
  template: `
    <main class="page coins">
      <header>
        <div>
          <span class="eyebrow">Coin ranking</span>
          <h1>Coins</h1>
          <p class="muted sub">Tokens ranked by recent signal density and TIMEX outcome.</p>
        </div>
        <div class="header-metrics">
          <span class="status-pill brand">{{ coins().length }} ranked</span>
          <span class="status-pill dot ok">{{ totalMentions() }} mentions</span>
        </div>
      </header>

      @if (loading()) {
        <section class="coin-list" aria-hidden="true">
          @for (i of skeletons; track i) {
            <div class="panel coin-row skeleton"></div>
          }
        </section>
      } @else if (error()) {
        <section class="panel message error">{{ error() }}</section>
      } @else if (coins().length === 0) {
        <section class="panel message">No coin signals available.</section>
      } @else {
        <section class="coin-list" aria-label="Coin signal ranking">
          @for (coin of coins(); track coin.id; let index = $index) {
            <a class="panel coin-row" [routerLink]="['/app/alerts', coin.latestAlertId]">
              <span class="card-accent" aria-hidden="true"></span>
              <span class="rank" [class.medal]="index < 3">#{{ index + 1 }}</span>

              <div class="token-cell">
                <span class="token-avatar">{{ coin.symbol.slice(0, 3) }}</span>
                <span class="token-copy">
                  <strong>{{ coin.symbol }}</strong>
                  <small class="muted ellipsis">{{ coin.name }}</small>
                </span>
              </div>

              <span
                class="verdict"
                [class.super]="coin.verdict === 'SUPER TRADE'"
                [class.good]="coin.verdict === 'GOOD TRADE'"
                [class.avoid]="coin.verdict === 'AVOID'"
                >{{ coin.verdict }}</span
              >

              <div class="perf" [class.negative]="coin.averagePerformancePercent < 0">
                <strong>
                  {{ coin.averagePerformancePercent >= 0 ? '+' : ''
                  }}{{ coin.averagePerformancePercent | number: '1.1-1' }}%
                </strong>
                <span>avg TIMEX</span>
              </div>

              <dl>
                <div>
                  <dt>Signals</dt>
                  <dd>{{ coin.alertCount }}</dd>
                </div>
                <div>
                  <dt>Mentions</dt>
                  <dd>{{ coin.mentionCount }}</dd>
                </div>
                <div>
                  <dt>Best</dt>
                  <dd>
                    {{ coin.bestPerformancePercent >= 0 ? '+' : ''
                    }}{{ coin.bestPerformancePercent | number: '1.1-1' }}%
                  </dd>
                </div>
              </dl>

              <div class="spark" [class.negative]="coin.averagePerformancePercent < 0">
                @if (coin.sparkline.length) {
                  @for (point of coin.sparkline; track point.label) {
                    <span [style.height.%]="point.heightPercent" [title]="point.valuePercent + '%'"></span>
                  }
                } @else {
                  <span class="flat"></span>
                  <span class="flat"></span>
                  <span class="flat"></span>
                }
              </div>

              <footer>
                <span class="ellipsis">{{ coin.topCaller }}</span>
                <time [dateTime]="coin.latestAt">{{ coin.latestAt | date: 'MMM d, h:mm a' }}</time>
              </footer>
            </a>
          }
        </section>
      }
    </main>
  `,
  styles: `
    .coins {
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
      letter-spacing: 0;
    }

    .sub {
      margin: 0;
    }

    .coin-list {
      display: grid;
      gap: 0.72rem;
    }

    .coin-row {
      position: relative;
      display: grid;
      grid-template-columns:
        4rem minmax(12rem, 1.1fr) auto minmax(7rem, 0.55fr) minmax(13rem, 0.9fr)
        minmax(7rem, 0.55fr) minmax(10rem, 0.75fr);
      align-items: center;
      gap: 0.9rem;
      min-height: 5.7rem;
      padding: 0.95rem 1rem;
      overflow: hidden;
      transition:
        transform 180ms ease,
        border-color 180ms ease,
        box-shadow 180ms ease;
    }

    .coin-row:hover {
      transform: translateX(3px);
      border-color: var(--glass-border-strong);
      box-shadow:
        0 28px 50px -28px rgba(0, 0, 0, 0.95),
        0 0 0 1px rgba(255, 176, 32, 0.18);
    }

    .card-accent {
      position: absolute;
      inset: 0 0 auto 0;
      height: 2px;
      background: linear-gradient(90deg, transparent, var(--gold), transparent);
      opacity: 0;
      transition: opacity 180ms ease;
    }

    .coin-row:hover .card-accent {
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
      width: 2.7rem;
      height: 2.7rem;
      border: 1px solid var(--glass-border);
      border-radius: var(--radius-sm);
      background: rgba(255, 255, 255, 0.05);
      color: var(--gold-bright);
      font-size: 0.84rem;
      font-weight: 500;
    }

    .token-copy {
      display: grid;
      min-width: 0;
    }

    .token-copy strong {
      font-size: 1.2rem;
      font-weight: 500;
    }

    .verdict {
      justify-self: start;
      border: 1px solid var(--glass-border);
      border-radius: 999px;
      padding: 0.28rem 0.58rem;
      color: var(--neutral);
      font-size: 0.62rem;
      font-weight: 500;
      white-space: nowrap;
    }

    .verdict.super {
      border-color: rgba(255, 176, 32, 0.42);
      color: var(--gold-bright);
    }

    .verdict.good {
      border-color: rgba(52, 211, 158, 0.34);
      color: var(--good);
    }

    .verdict.avoid {
      border-color: rgba(255, 93, 108, 0.34);
      color: var(--avoid);
    }

    .perf {
      display: grid;
      gap: 0.12rem;
      font-variant-numeric: tabular-nums;
    }

    .perf strong {
      color: var(--good);
      font-size: 1.05rem;
      font-weight: 500;
    }

    .perf.negative strong {
      color: var(--avoid);
    }

    .perf span,
    dt {
      color: var(--ink-dim);
      font-size: 0.68rem;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }

    dl {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 0.6rem;
      margin: 0;
    }

    dd {
      margin: 0.2rem 0 0;
      font-weight: 500;
      font-variant-numeric: tabular-nums;
    }

    .spark {
      display: flex;
      align-items: end;
      gap: 0.22rem;
      height: 2.2rem;
      padding: 0.25rem;
      border-radius: 0.7rem;
      background: rgba(255, 255, 255, 0.03);
    }

    .spark span {
      flex: 1;
      min-height: 0.32rem;
      border-radius: 999px 999px 0 0;
      background: linear-gradient(180deg, var(--good), rgba(52, 211, 158, 0.24));
    }

    .spark.negative span {
      background: linear-gradient(180deg, var(--avoid), rgba(255, 93, 108, 0.24));
    }

    .spark .flat {
      height: 45%;
      background: rgba(139, 149, 181, 0.32);
    }

    footer {
      display: grid;
      gap: 0.12rem;
      justify-items: end;
      color: var(--ink-dim);
      font-size: 0.78rem;
      min-width: 0;
    }

    time {
      white-space: nowrap;
    }

    .ellipsis {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .message {
      padding: 2rem;
      text-align: center;
    }

    .message.error {
      color: var(--avoid);
    }

    .skeleton {
      min-height: 5.7rem;
    }

    @media (max-width: 980px) {
      .coin-row {
        grid-template-columns: auto 1fr;
        align-items: start;
      }

      .rank {
        grid-row: span 6;
      }

      .token-cell,
      .verdict,
      .perf,
      dl,
      .spark,
      footer {
        grid-column: 2;
      }

      footer {
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
export class CoinListPage implements OnInit {
  private readonly coinsApi = inject(CoinsApi);

  readonly coins = signal<CoinSignalSummary[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly skeletons = [0, 1, 2, 3, 4, 5, 6, 7];
  readonly totalMentions = computed(() =>
    this.coins().reduce((sum, coin) => sum + coin.mentionCount, 0)
  );

  ngOnInit(): void {
    this.coinsApi.listCoins().subscribe({
      next: (coins) => {
        this.coins.set(coins);
        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.error.set(error instanceof Error ? error.message : 'Unable to load coins');
        this.loading.set(false);
      }
    });
  }
}
