import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';

import { AuthService } from '../../core/auth/auth.service';
import { appEnvironment } from '../../core/config/app-environment';
import { SignalrService } from '../../core/realtime/signalr.service';
import { RawDbApi } from '../../data-access/raw-db/raw-db.api';
import { RawDbInfluencer, RawDbMention } from '../../data-access/raw-db/raw-db.types';
import { HealthApi, HealthStatus } from '../../data-access/system/health.api';

@Component({
  selector: 'ithac-settings-page',
  imports: [DatePipe, DecimalPipe],
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

      <nav class="settings-tabs" aria-label="Settings sections">
        <button
          type="button"
          [class.active]="activeTab() === 'overview'"
          (click)="selectTab('overview')"
        >
          Overview
        </button>
        <button
          type="button"
          [class.active]="activeTab() === 'raw-db'"
          (click)="selectTab('raw-db')"
        >
          Raw DB
        </button>
      </nav>

      @if (activeTab() === 'overview') {
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
              <dt>Raw DB API</dt>
              <dd class="ellipsis">{{ rawDbApiBaseUrl }}</dd>
            </div>
            <div>
              <dt>Data source</dt>
              <dd>{{ useMockData ? 'Mock fixtures' : 'Product backend' }}</dd>
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
      } @else {
        <section class="panel raw-db">
          <div class="block-head">
            <div>
              <h2>Raw DB</h2>
              <p class="muted sub">
                Audit-only views from MySQL. No product filter, no ranking, no AI interpretation.
              </p>
            </div>
            <div class="raw-actions">
              <span class="status-pill dot" [class.ok]="rawStatusOk()" [class.bad]="activeRawError()">
                {{ activeRawStatus() }}
              </span>
              <button class="button secondary" type="button" [disabled]="activeRawLoading()" (click)="refreshActiveRaw()">
                {{ activeRawLoading() ? 'Refreshing' : 'Refresh raw' }}
              </button>
            </div>
          </div>

          <nav class="settings-tabs sub-tabs" aria-label="Raw DB sections">
            <button
              type="button"
              [class.active]="rawDbSection() === 'database'"
              (click)="selectRawDbSection('database')"
            >
              Database
            </button>
            <button
              type="button"
              [class.active]="rawDbSection() === 'influencers'"
              (click)="selectRawDbSection('influencers')"
            >
              Influenceurs
            </button>
          </nav>

          @if (activeRawError()) {
            <div class="message error">{{ activeRawError() }}</div>
          }

          @if (rawDbSection() === 'database') {
            <div class="raw-table" aria-label="Raw database mention feed">
              <div class="raw-head mentions-head">
                <span>Token</span>
                <span>Post</span>
                <span>Influencer</span>
                <span>Time</span>
                <span>Age</span>
              </div>

              @if (rawDbLoading() && rawDbMentions().length === 0) {
                @for (item of skeletonRows; track item) {
                  <div class="raw-row mentions-row skeleton-row"></div>
                }
              } @else {
                @for (mention of rawDbMentions(); track mention.id) {
                  <article class="raw-row mentions-row">
                    <div class="token">
                      <strong>{{ mention.tokenSymbol }}</strong>
                      <small class="muted ellipsis">{{ mention.tokenName }}</small>
                    </div>
                    <div class="post">
                      <strong class="ellipsis" [title]="mention.text">{{ rawSnippet(mention) }}</strong>
                      <small class="muted ellipsis">DB {{ mention.id }} · post {{ mention.postId }}</small>
                    </div>
                    <div class="links">
                      <a [href]="mention.profileUrl" target="_blank" rel="noopener noreferrer">
                        {{ mention.influencer }}
                      </a>
                      @if (mention.postUrl) {
                        <a [href]="mention.postUrl" target="_blank" rel="noopener noreferrer">X post</a>
                      }
                    </div>
                    <time [dateTime]="mention.mentionedAt">
                      {{ mention.mentionedAt | date: 'MMM d, h:mm a' }}
                    </time>
                    <time [dateTime]="mention.mentionedAt">{{ relativeTime(mention.mentionedAt) }}</time>
                  </article>
                }
              }
            </div>
          } @else {
            <div class="raw-table" aria-label="Raw database influencer list">
              <div class="raw-head influencers-head">
                <span>Influenceur</span>
                <button
                  class="sort-head"
                  type="button"
                  (click)="toggleInfluencerSort('followers')"
                  [attr.aria-label]="'Sort influencers by followers ' + nextSortLabel('followers')"
                >
                  Followers {{ sortIndicator('followers') }}
                </button>
                <span>Mentions</span>
                <span>Posts</span>
                <span>Tokens</span>
                <span>Latest</span>
              </div>

              @if (rawInfluencersLoading() && rawInfluencers().length === 0) {
                @for (item of skeletonRows; track item) {
                  <div class="raw-row influencers-row skeleton-row"></div>
                }
              } @else {
                @for (influencer of sortedRawInfluencers(); track influencer.influencerId) {
                  <article class="raw-row influencers-row">
                    <div class="influencer-identity">
                      @if (influencer.profileImageUrl) {
                        <img [src]="influencer.profileImageUrl" [alt]="influencer.username" />
                      }
                      <span>
                        <strong class="ellipsis">{{ influencer.name ?? influencer.username }}</strong>
                        @if (influencer.profileUrl) {
                          <a [href]="influencer.profileUrl" target="_blank" rel="noopener noreferrer">
                            @{{ influencer.username }}
                          </a>
                        } @else {
                          <small class="muted">@{{ influencer.username }}</small>
                        }
                      </span>
                    </div>
                    <strong>{{ influencer.followersCount | number }}</strong>
                    <strong>{{ influencer.rawMentionCount | number }}</strong>
                    <strong>{{ influencer.rawPostCount | number }}</strong>
                    <strong>{{ influencer.rawTokenCount | number }}</strong>
                    <time [dateTime]="influencer.latestMentionAt ?? ''">
                      {{ influencer.latestMentionAt ? relativeTime(influencer.latestMentionAt) : 'none' }}
                    </time>
                  </article>
                }
              }
            </div>
          }
        </section>
      }
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

    .settings-tabs {
      display: inline-flex;
      width: fit-content;
      padding: 0.25rem;
      border: 1px solid var(--glass-border);
      border-radius: var(--radius-sm);
      background: rgba(255, 255, 255, 0.035);
    }

    .settings-tabs button {
      min-height: 2rem;
      border: 0;
      border-radius: 0.65rem;
      padding: 0.35rem 0.8rem;
      background: transparent;
      color: var(--ink-muted);
      font-weight: 500;
    }

    .settings-tabs button.active {
      background: rgba(255, 176, 32, 0.14);
      color: var(--gold-bright);
    }

    .sub-tabs {
      width: fit-content;
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

    .raw-db {
      display: grid;
      gap: 1rem;
      padding: 1.25rem;
    }

    .raw-actions {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex-wrap: wrap;
    }

    .message.error {
      border: 1px solid rgba(255, 93, 108, 0.28);
      border-radius: var(--radius-sm);
      padding: 0.7rem 0.85rem;
      color: var(--avoid);
      background: rgba(255, 93, 108, 0.08);
    }

    .raw-table {
      display: grid;
      gap: 0.5rem;
    }

    .mentions-head,
    .mentions-row {
      display: grid;
      grid-template-columns: minmax(7rem, 0.55fr) minmax(20rem, 2fr) minmax(9rem, 0.7fr) minmax(8rem, 0.55fr) minmax(5rem, 0.35fr);
      gap: 0.8rem;
      align-items: center;
    }

    .influencers-head,
    .influencers-row {
      display: grid;
      grid-template-columns: minmax(15rem, 1.4fr) repeat(4, minmax(5.5rem, 0.45fr)) minmax(5rem, 0.35fr);
      gap: 0.8rem;
      align-items: center;
    }

    .raw-head {
      padding: 0 0.85rem;
      color: var(--ink-dim);
      font-size: 0.68rem;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }

    .sort-head {
      border: 0;
      padding: 0;
      background: transparent;
      color: inherit;
      font: inherit;
      font-weight: 600;
      letter-spacing: inherit;
      text-align: left;
      text-transform: inherit;
    }

    .sort-head:hover {
      color: var(--gold-bright);
    }

    .raw-row {
      min-height: 4.5rem;
      border: 1px solid var(--glass-border);
      border-radius: var(--radius-sm);
      padding: 0.75rem 0.85rem;
      background: rgba(255, 255, 255, 0.03);
    }

    .raw-row .token,
    .raw-row .post,
    .raw-row .links {
      display: grid;
      min-width: 0;
      gap: 0.18rem;
    }

    .raw-row a {
      color: var(--ink);
      font-weight: 500;
    }

    .raw-row a:hover {
      color: var(--gold-bright);
    }

    .raw-row time {
      color: var(--ink-muted);
      font-size: 0.82rem;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }

    .influencer-identity {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      align-items: center;
      gap: 0.65rem;
      min-width: 0;
    }

    .influencer-identity img {
      width: 2.3rem;
      height: 2.3rem;
      border-radius: 0.7rem;
      border: 1px solid var(--glass-border);
      object-fit: cover;
      background: rgba(255, 255, 255, 0.06);
    }

    .influencer-identity span {
      display: grid;
      min-width: 0;
      gap: 0.12rem;
    }

    .skeleton-row {
      min-height: 4.5rem;
      opacity: 0.5;
    }

    @media (max-width: 900px) {
      .grid,
      .stats,
      .raw-head,
      .raw-row,
      .mentions-row,
      .influencers-row {
        grid-template-columns: 1fr;
      }

      .raw-head {
        display: none;
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
  readonly activeTab = signal<'overview' | 'raw-db'>('overview');
  readonly rawDbSection = signal<'database' | 'influencers'>('database');
  readonly rawDbMentions = signal<RawDbMention[]>([]);
  readonly rawDbLoading = signal(false);
  readonly rawDbError = signal<string | null>(null);
  readonly rawInfluencers = signal<RawDbInfluencer[]>([]);
  readonly rawInfluencerTotal = signal(0);
  readonly rawInfluencersLoading = signal(false);
  readonly rawInfluencersError = signal<string | null>(null);
  readonly influencerSort = signal<{ key: 'followers'; direction: 'asc' | 'desc' }>({
    key: 'followers',
    direction: 'desc'
  });
  readonly apiBaseUrl = appEnvironment.apiBaseUrl;
  readonly rawDbApiBaseUrl = appEnvironment.rawDbApiBaseUrl;
  readonly signalrHubUrl = appEnvironment.signalrHubUrl;
  readonly useMockData = appEnvironment.useMockData;
  readonly enableRealtime = appEnvironment.enableRealtime;
  readonly skeletonRows = [0, 1, 2, 3, 4, 5];

  readonly firebaseReady = computed(() => appEnvironment.firebase.webApiKey.trim().length > 0);
  readonly authProviderLabel = computed(() =>
    appEnvironment.authProvider === 'firebase-password'
      ? 'Firebase password'
      : appEnvironment.production
        ? 'Preview access'
        : 'Local dev token'
  );
  readonly initials = computed(() =>
    (this.auth.user()?.displayName ?? this.auth.user()?.email ?? 'IT')
      .split(/\s|@/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
  );
  readonly sortedRawInfluencers = computed(() => {
    const sort = this.influencerSort();
    return [...this.rawInfluencers()].sort((a, b) => {
      const left = a.followersCount;
      const right = b.followersCount;
      const result = left === right ? a.username.localeCompare(b.username) : left - right;
      return sort.direction === 'asc' ? result : -result;
    });
  });

  private readonly healthApi = inject(HealthApi);
  private readonly rawDbApi = inject(RawDbApi);

  ngOnInit(): void {
    this.refreshHealth();
    this.realtime.connect();
  }

  selectTab(tab: 'overview' | 'raw-db'): void {
    this.activeTab.set(tab);
    if (tab === 'raw-db' && this.rawDbMentions().length === 0 && !this.rawDbLoading()) {
      this.refreshRawDb();
    }
  }

  selectRawDbSection(section: 'database' | 'influencers'): void {
    this.rawDbSection.set(section);
    if (section === 'database' && this.rawDbMentions().length === 0 && !this.rawDbLoading()) {
      this.refreshRawDb();
    }
    if (section === 'influencers' && this.rawInfluencers().length === 0 && !this.rawInfluencersLoading()) {
      this.refreshInfluencers();
    }
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

  refreshRawDb(): void {
    this.rawDbLoading.set(true);
    this.rawDbError.set(null);

    this.rawDbApi.listMentions(30).subscribe({
      next: (mentions) => {
        this.rawDbMentions.set(mentions);
        this.rawDbLoading.set(false);
      },
      error: (error: unknown) => {
        this.rawDbError.set(error instanceof Error ? error.message : 'Unable to load Raw DB');
        this.rawDbLoading.set(false);
      }
    });
  }

  refreshInfluencers(): void {
    this.rawInfluencersLoading.set(true);
    this.rawInfluencersError.set(null);

    this.rawDbApi.listInfluencers(2500).subscribe({
      next: (response) => {
        this.rawInfluencerTotal.set(response.total);
        this.rawInfluencers.set(response.data);
        this.rawInfluencersLoading.set(false);
      },
      error: (error: unknown) => {
        this.rawInfluencersError.set(
          error instanceof Error ? error.message : 'Unable to load raw influencers'
        );
        this.rawInfluencersLoading.set(false);
      }
    });
  }

  toggleInfluencerSort(key: 'followers'): void {
    this.influencerSort.update((current) => ({
      key,
      direction: current.key === key && current.direction === 'desc' ? 'asc' : 'desc'
    }));
  }

  sortIndicator(key: 'followers'): string {
    const sort = this.influencerSort();
    if (sort.key !== key) {
      return '';
    }

    return sort.direction === 'desc' ? '↓' : '↑';
  }

  nextSortLabel(key: 'followers'): string {
    const sort = this.influencerSort();
    return sort.key === key && sort.direction === 'desc' ? 'ascending' : 'descending';
  }

  refreshActiveRaw(): void {
    if (this.rawDbSection() === 'database') {
      this.refreshRawDb();
      return;
    }

    this.refreshInfluencers();
  }

  activeRawLoading(): boolean {
    return this.rawDbSection() === 'database'
      ? this.rawDbLoading()
      : this.rawInfluencersLoading();
  }

  activeRawError(): string | null {
    return this.rawDbSection() === 'database'
      ? this.rawDbError()
      : this.rawInfluencersError();
  }

  rawStatusOk(): boolean {
    return !this.activeRawError();
  }

  activeRawStatus(): string {
    if (this.activeRawLoading()) {
      return 'loading';
    }

    const error = this.activeRawError();
    if (error) {
      return 'error';
    }

    if (this.rawDbSection() === 'database') {
      return `${this.rawDbMentions().length} rows`;
    }

    return `${this.rawInfluencers().length}/${this.rawInfluencerTotal()} influenceurs`;
  }

  rawSnippet(mention: RawDbMention): string {
    return mention.text.replace(/\s+/g, ' ').trim();
  }

  relativeTime(value: string): string {
    const timestamp = new Date(value).getTime();
    if (!Number.isFinite(timestamp)) {
      return 'unknown';
    }

    const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
    if (seconds < 60) return 'now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;
    return `${Math.floor(hours / 24)}d`;
  }
}
