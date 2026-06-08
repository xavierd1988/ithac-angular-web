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
          <span class="eyebrow">Coin radar</span>
          <h1>Coins</h1>
          <p class="muted sub">{{ totalSignals() }} signals grouped by token.</p>
        </div>
        <span class="status-pill brand">{{ coins().length }} tracked</span>
      </header>

      @if (loading()) {
        <section class="panel message">Loading coins...</section>
      } @else if (error()) {
        <section class="panel message error">{{ error() }}</section>
      } @else if (coins().length === 0) {
        <section class="panel message">No coin signals available.</section>
      } @else {
        <section class="grid" aria-label="Coin signal board">
          @for (coin of coins(); track coin.id) {
            <a class="panel coin-card" [routerLink]="['/app/alerts', coin.latestAlertId]">
              <div class="topline">
                <span class="token-avatar">{{ coin.symbol.slice(0, 3) }}</span>
                <span class="token-copy">
                  <strong>{{ coin.symbol }}</strong>
                  <small class="muted ellipsis">{{ coin.name }}</small>
                </span>
                <span
                  class="verdict"
                  [class.super]="coin.verdict === 'SUPER TRADE'"
                  [class.good]="coin.verdict === 'GOOD TRADE'"
                  [class.avoid]="coin.verdict === 'AVOID'"
                  >{{ coin.verdict }}</span
                >
              </div>

              <div class="perf" [class.negative]="coin.averagePerformancePercent < 0">
                {{ coin.averagePerformancePercent >= 0 ? '+' : ''
                }}{{ coin.averagePerformancePercent | number: '1.1-1' }}%
                <span>avg TIMEX</span>
              </div>

              @if (coin.sparkline.length) {
                <div class="spark" [class.negative]="coin.averagePerformancePercent < 0">
                  @for (point of coin.sparkline; track point.label) {
                    <span [style.height.%]="point.heightPercent" [title]="point.valuePercent + '%'"></span>
                  }
                </div>
              }

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
                  <dd>{{ coin.bestPerformancePercent >= 0 ? '+' : ''
                  }}{{ coin.bestPerformancePercent | number: '1.1-1' }}%</dd>
                </div>
              </dl>

              <footer>
                <span class="ellipsis">{{ coin.topCaller }}</span>
                <time [dateTime]="coin.latestAt">{{ coin.latestAt | date: 'shortTime' }}</time>
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

    header,
    .topline,
    footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
    }

    header {
      align-items: flex-end;
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
      letter-spacing: 0;
    }

    .sub {
      margin: 0;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(18rem, 1fr));
      gap: 1rem;
    }

    .coin-card {
      display: grid;
      gap: 1rem;
      padding: 1.15rem;
      overflow: hidden;
    }

    .token-avatar {
      display: grid;
      place-items: center;
      width: 2.7rem;
      height: 2.7rem;
      border-radius: var(--radius-sm);
      border: 1px solid var(--glass-border);
      background: rgba(255, 255, 255, 0.05);
      color: var(--gold-bright);
      font-size: 0.84rem;
      font-weight: 500;
    }

    .token-copy {
      display: grid;
      min-width: 0;
      margin-right: auto;
    }

    .token-copy strong {
      font-size: 1.25rem;
    }

    .verdict {
      border-radius: 999px;
      padding: 0.28rem 0.58rem;
      border: 1px solid var(--glass-border);
      color: var(--neutral);
      font-size: 0.62rem;
      font-weight: 500;
      white-space: nowrap;
    }

    .verdict.super {
      color: var(--gold-bright);
      border-color: rgba(255, 176, 32, 0.42);
    }

    .verdict.good {
      color: var(--good);
      border-color: rgba(52, 211, 158, 0.34);
    }

    .verdict.avoid {
      color: var(--avoid);
      border-color: rgba(255, 93, 108, 0.34);
    }

    .perf {
      color: var(--good);
      font-size: 2.35rem;
      font-weight: 500;
      font-variant-numeric: tabular-nums;
      letter-spacing: 0;
    }

    .perf.negative {
      color: var(--avoid);
    }

    .perf span {
      display: block;
      color: var(--ink-dim);
      font-size: 0.76rem;
      font-weight: 500;
      text-transform: uppercase;
    }

    .spark {
      display: flex;
      align-items: end;
      gap: 0.32rem;
      height: 3.4rem;
      padding: 0.45rem;
      border-radius: var(--radius-sm);
      background: rgba(255, 255, 255, 0.03);
    }

    .spark span {
      flex: 1;
      min-height: 0.35rem;
      border-radius: 999px 999px 0 0;
      background: linear-gradient(180deg, var(--good), rgba(52, 211, 158, 0.24));
    }

    .spark.negative span {
      background: linear-gradient(180deg, var(--avoid), rgba(255, 93, 108, 0.24));
    }

    dl {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 0.65rem;
      margin: 0;
    }

    dt {
      color: var(--ink-dim);
      font-size: 0.68rem;
      text-transform: uppercase;
    }

    dd {
      margin: 0.2rem 0 0;
      font-weight: 500;
      font-variant-numeric: tabular-nums;
    }

    footer,
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
      padding: 2rem;
      text-align: center;
    }

    .message.error {
      color: var(--avoid);
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
  readonly totalSignals = computed(() =>
    this.coins().reduce((sum, coin) => sum + coin.alertCount, 0)
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
