import { NgClass } from '@angular/common';
import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { CockpitApi, InfluencerPageParams } from './data/cockpit.api';
import {
  ApiHealth,
  ApiJobStatus,
  ApiRunStatus,
  CockpitSnapshot,
  EventRow,
  InfluencerJob,
  InfluencerRow,
  JobHistory,
  JobHistoryRow,
  LiveEventMessage,
  ProxyRow,
  ProxyResource,
  RecentPost,
  RecentPostRow,
  RunMode,
  RunHistory,
  RunHistoryRow,
  ScoreRow,
  SessionResource,
  SessionRow,
  SlotRow,
  UiJobStatus,
  UiRunStatus
} from './data/cockpit.types';

@Component({
  selector: 'app-root',
  imports: [FormsModule, NgClass],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App implements OnDestroy, OnInit {
  private readonly api = inject(CockpitApi);
  private readonly fallbackRefreshEveryMs = 2500;
  private readonly quickScrapeTargetCount = 40;
  private readonly scraperTraceWindowMs = 15_000;
  private readonly liveWatchdogEveryMs = 5000;
  private readonly liveStaleAfterMs = 20000;
  private refreshTimer: ReturnType<typeof setInterval> | undefined;
  private filterTimer: ReturnType<typeof setTimeout> | undefined;
  private liveWatchdogTimer: ReturnType<typeof setInterval> | undefined;
  private activeRunTimer: ReturnType<typeof setInterval> | undefined;
  private liveEvents: EventSource | null = null;
  private lastLiveSignalAt = 0;
  private snapshotLoading = false;

  readonly bulkActionRunning = signal(false);
  readonly mode = signal<RunMode>('Safe');
  readonly status = signal<UiRunStatus>('ready');
  readonly newInfluencer = signal('');
  readonly bulkInfluencers = signal('');
  readonly filterText = signal('');
  readonly filterStatus = signal<'all' | UiJobStatus>('all');
  readonly priorityOnly = signal(false);
  readonly pageIndex = signal(0);
  readonly pageSize = signal(250);
  readonly selectedSessionName = signal<string | null>(null);
  readonly selectedProxyName = signal<string | null>(null);
  readonly source = signal<'api' | 'mock'>('mock');
  readonly targetCount = signal(2000);
  readonly total = signal(0);
  readonly completed = signal(0);
  readonly running = signal(0);
  readonly failed = signal(0);
  readonly enabled = signal(0);
  readonly filteredTotal = signal(0);
  readonly influencers = signal<InfluencerRow[]>([]);
  readonly slots = signal<SlotRow[]>([]);
  readonly sessions = signal<SessionRow[]>([]);
  readonly proxies = signal<ProxyRow[]>([]);
  readonly recentPosts = signal<RecentPostRow[]>([]);
  readonly selectedPostsByUsername = signal<Record<string, RecentPostRow[]>>({});
  readonly scores = signal<ScoreRow[]>([]);
  readonly jobHistory = signal<JobHistoryRow[]>([]);
  readonly runHistory = signal<RunHistoryRow[]>([]);
  readonly events = signal<EventRow[]>([]);
  readonly loadError = signal<string | null>(null);
  readonly lastRefreshedAt = signal<string | null>(null);
  readonly liveTransport = signal<'sse' | 'polling'>('polling');
  readonly selectedInfluencers = signal<ReadonlySet<string>>(new Set<string>());
  readonly selectedUsername = signal<string | null>(null);
  readonly traceClock = signal(Date.now());

  readonly visibleInfluencers = computed(() => this.influencers());
  readonly visibleCount = computed(() => this.filteredTotal());
  readonly pageCount = computed(() => Math.max(1, Math.ceil(this.visibleCount() / this.pageSize())));
  readonly effectivePageIndex = computed(() => Math.min(this.pageIndex(), this.pageCount() - 1));
  readonly pageStart = computed(() => this.effectivePageIndex() * this.pageSize());
  readonly pageEnd = computed(() => Math.min(this.pageStart() + this.pageSize(), this.visibleCount()));
  readonly pagedVisibleInfluencers = computed(() => this.visibleInfluencers());
  readonly pageUsernames = computed(() => this.pagedVisibleInfluencers().map((row) => row.username));
  readonly selectedInfluencerCount = computed(() => this.selectedInfluencers().size);
  readonly currentPageHasRows = computed(() => this.pageUsernames().length > 0);
  readonly allCurrentPageSelected = computed(() => {
    const usernames = this.pageUsernames();
    const selected = this.selectedInfluencers();
    return usernames.length > 0 && usernames.every((username) => selected.has(username));
  });
  readonly someCurrentPageSelected = computed(() => this.selectedInfluencerCount() > 0 && !this.allCurrentPageSelected());
  readonly progress = computed(() => Math.round((this.completed() / Math.max(this.total(), 1)) * 100));
  readonly statusFilters: ReadonlyArray<'all' | UiJobStatus> = ['all', 'queued', 'running', 'success', 'failed', 'paused'];
  readonly pageSizes: ReadonlyArray<number> = [250, 500, 1000, 2000];
  readonly selectedSession = computed(() =>
    this.sessions().find((item) => item.name === this.selectedSessionName()) ?? null);
  readonly selectedProxy = computed(() =>
    this.proxies().find((item) => item.name === this.selectedProxyName()) ?? null);
  readonly queuedCount = computed(() =>
    Math.max(0, this.total() - this.completed() - this.running() - this.failed()));
  readonly activeScraper = computed(() =>
    this.jobHistory().find((job) => job.status === 'running')
      ?? this.jobHistory().find((job) => this.isRecentScraperJob(job))
      ?? null);
  readonly scannerMode = computed<'live' | 'idle'>(() =>
    this.activeScraper() || this.status() === 'running' || this.running() > 0 || this.scannerBlocked() ? 'live' : 'idle');
  readonly scannerModeLabel = computed(() => {
    return this.scannerMode() === 'live' ? 'scraping live' : 'scanner idle';
  });
  readonly visibleScannerUsername = computed(() => this.activeScraper()?.username ?? null);
  readonly activeScannerCount = computed(() => this.running() || (this.visibleScannerUsername() ? 1 : 0));
  readonly activeScannerLabel = computed(() => {
    const username = this.visibleScannerUsername();
    const eventUsername = this.latestEventUsername();
    if (username) {
      return `@${username}`;
    }
    if (this.scannerBlocked() && eventUsername) {
      return `blocked @${eventUsername}`;
    }
    return 'idle';
  });
  readonly scannerPositionLabel = computed(() => {
    const job = this.activeScraper();
    if (job) {
      return `@${job.username}`;
    }
    const eventUsername = this.latestEventUsername();
    if (this.scannerBlocked() && eventUsername) {
      return `blocked @${eventUsername}`;
    }
    const run = this.latestRun();
    if (this.status() === 'running' || run?.status === 'running') {
      return `${run ? `Run #${run.id}` : 'Run'} waiting`;
    }
    return 'idle';
  });
  readonly scannerPositionMeta = computed(() => {
    const job = this.activeScraper();
    if (!job) {
      const run = this.latestRun();
      const event = this.latestEvent();
      if (this.scannerBlocked() && event) {
        return `${this.completed()}/${Math.max(this.total(), 1)} done · no available session/proxy · ${event.at}`;
      }
      if (this.status() === 'running' || run?.status === 'running') {
        return `${this.completed()}/${Math.max(this.total(), 1)} done · waiting for next job`;
      }
      return 'no active scrape';
    }

    const index = this.liveRows().findIndex((row) => row.username.toLowerCase() === job.username.toLowerCase());
    const position = index >= 0
      ? `row ${this.pageStart() + index + 1}/${this.visibleCount()}`
      : `not on page ${this.effectivePageIndex() + 1}`;
    const phase = job.status === 'running' ? 'now' : 'last';
    return `${phase} · ${position} · ${job.resource} · ${this.formatMinute(job.startedAt ?? job.updatedAt)}`;
  });
  readonly activeSlots = computed(() =>
    this.slots().filter((slot) => slot.current && slot.current.toLowerCase() !== 'idle'));
  readonly availableSessions = computed(() =>
    this.sessions().filter((session) => session.enabled && session.health === 'available').length);
  readonly availableProxies = computed(() =>
    this.proxies().filter((proxy) => proxy.enabled && proxy.health === 'available').length);
  readonly resourceIssues = computed(() =>
    [...this.sessions(), ...this.proxies()].filter((item) => item.health !== 'available').length);
  readonly latestRun = computed(() => this.runHistory()[0] ?? null);
  readonly latestEvent = computed(() => this.events()[0] ?? null);
  readonly latestEventUsername = computed(() => this.usernameFromText(this.latestEvent()?.text ?? ''));
  readonly scannerBlocked = computed(() => {
    const event = this.latestEvent();
    return Boolean(event?.text.toLowerCase().includes('no available session/proxy'));
  });
  readonly scannerMonitorTitle = computed(() => {
    const job = this.activeScraper();
    if (job?.status === 'running') {
      return `SCRAPING @${job.username}`;
    }
    const eventUsername = this.latestEventUsername();
    if (this.scannerBlocked() && eventUsername) {
      return `BLOCKED ON @${eventUsername}`;
    }
    if (this.status() === 'running' || this.latestRun()?.status === 'running') {
      return `RUNNING · ${this.completed()}/${this.total()} DONE`;
    }
    return 'SCANNER IDLE';
  });
  readonly scannerMonitorMeta = computed(() => {
    const event = this.latestEvent();
    const job = this.activeScraper();
    const progress = `${this.completed()}/${Math.max(this.total(), 1)} done · ${this.queuedCount()} queued · ${this.failed()} failed`;
    if (job?.status === 'running') {
      return `${progress} · ${job.resource} · opened ${this.timeAgo(job.startedAt ?? job.updatedAt)}`;
    }
    if (this.scannerBlocked() && event) {
      return `${progress} · ${event.text} · ${event.at}`;
    }
    if (event) {
      return `${progress} · latest: ${event.text} · ${event.at}`;
    }
    return progress;
  });
  readonly scannerMonitorClass = computed(() => {
    if (this.scannerBlocked()) {
      return 'blocked';
    }
    if (this.scannerMode() === 'live') {
      return 'live';
    }
    return 'idle';
  });
  readonly latestRunLabel = computed(() => {
    const run = this.latestRun();
    return run ? `Run #${run.id}` : 'No run';
  });
  readonly latestEventLevel = computed(() => this.latestEvent()?.level ?? 'quiet');
  readonly liveRows = computed(() => this.pagedVisibleInfluencers());
  readonly selectedRow = computed(() => {
    const username = this.selectedUsername();
    if (!username) {
      return null;
    }
    return this.influencers().find((row) => row.username.toLowerCase() === username.toLowerCase()) ?? null;
  });
  readonly scrapeSteps = [
    { key: 'open', label: 'Open page' },
    { key: 'read', label: 'Read posts' },
    { key: 'extract', label: 'Extract data' },
    { key: 'store', label: 'Store' }
  ] as const;
  readonly scrapeScopeSummary =
    'Reads X UserTweets cursor pages, not an infinite visual scroll: max 50 candidate posts, 24h window, 15 timeline pages, stops early on old or already-stored posts.';
  readonly latestJobByUsername = computed(() => {
    const jobs = new Map<string, JobHistoryRow>();
    for (const job of this.jobHistory()) {
      const key = job.username.toLowerCase();
      if (!jobs.has(key)) {
        jobs.set(key, job);
      }
    }
    return jobs;
  });
  readonly recentPostsByUsername = computed(() => {
    const posts = new Map<string, RecentPostRow[]>();
    for (const post of this.recentPosts()) {
      const key = post.username.toLowerCase();
      const rows = posts.get(key) ?? [];
      if (rows.length < 3) {
        rows.push(post);
        posts.set(key, rows);
      }
    }
    return posts;
  });

  isRowActivelyScraping(row: InfluencerRow): boolean {
    return this.latestJobFor(row.username)?.status === 'running';
  }

  isRowInScraperTrace(row: InfluencerRow): boolean {
    if (this.visibleScannerUsername()?.toLowerCase() === row.username.toLowerCase()) {
      return true;
    }

    const job = this.latestJobFor(row.username);
    return job?.status === 'running' || Boolean(job && this.isRecentScraperJob(job));
  }

  scraperBadge(row: InfluencerRow): string {
    return this.isRowActivelyScraping(row) ? 'SCRAPER' : 'SCRAPED';
  }

  scraperStateLabel(row: InfluencerRow): string {
    return this.isRowActivelyScraping(row) ? 'SCRAPING' : 'SCRAPED';
  }

  private usernameFromText(text: string): string | null {
    const match = text.match(/@([A-Za-z0-9_]+)/);
    return match?.[1] ?? null;
  }

  scraperDetailLabel(row: InfluencerRow): string {
    return this.isRowActivelyScraping(row) ? 'Live scan in progress' : 'Scraped moments ago';
  }

  rowProgress(row: InfluencerRow): number {
    if (row.status === 'success' || row.status === 'failed') {
      return 100;
    }
    if (row.status === 'paused') {
      return 0;
    }

    const job = this.latestJobFor(row.username);
    if (!job) {
      return row.status === 'running' ? 24 : 0;
    }
    if (job.status === 'success' || job.status === 'failed') {
      return 100;
    }
    if (job.status !== 'running') {
      return row.status === 'queued' ? 0 : 18;
    }

    if (job.postsStored > 0) {
      return 88;
    }
    if (job.mentionsFound > 0) {
      return 74;
    }
    if (job.postsSeen > 0) {
      return 56;
    }
    return 30;
  }

  rowActiveStep(row: InfluencerRow): string {
    const job = this.latestJobFor(row.username);
    if (row.status === 'success') {
      return 'complete';
    }
    if (row.status === 'failed') {
      return 'failed';
    }
    if (job?.postsStored) {
      return 'store';
    }
    if (job?.mentionsFound) {
      return 'extract';
    }
    if (job?.postsSeen) {
      return 'read';
    }
    return row.status === 'running' ? 'open' : 'waiting';
  }

  stepClass(row: InfluencerRow, stepKey: string): string {
    const active = this.rowActiveStep(row);
    const order = ['open', 'read', 'extract', 'store'];
    const activeIndex = order.indexOf(active);
    const stepIndex = order.indexOf(stepKey);
    if (active === 'complete') {
      return 'done';
    }
    if (stepKey === active) {
      return 'active';
    }
    if (activeIndex >= 0 && stepIndex < activeIndex) {
      return 'done';
    }
    return 'upcoming';
  }

  rowStatusLabel(row: InfluencerRow): string {
    if (row.status === 'success') {
      return 'complete';
    }
    if (row.status === 'running') {
      return 'scraping';
    }
    if (row.status === 'failed') {
      return 'failed';
    }
    if (row.status === 'paused') {
      return 'paused';
    }
    return 'waiting';
  }

  rowMeta(row: InfluencerRow): string {
    const job = this.latestJobFor(row.username);
    if (job) {
      return `${job.postsSeen} seen · ${job.postsStored} stored · ${job.mentionsFound} mentions`;
    }
    if (row.status === 'success') {
      return `${row.posts} posts · ${row.mentions} mentions`;
    }
    return row.lastEvent || row.outcome || 'Waiting for scraper';
  }

  rowScrapeMinute(row: InfluencerRow): string {
    const job = this.latestJobFor(row.username);
    if (!job) {
      return row.status === 'success' ? 'no recent job' : 'not scraped yet';
    }
    if (job.status === 'running') {
      return `opened ${this.timeAgo(job.startedAt ?? job.updatedAt)} · ${this.formatMinute(job.startedAt ?? job.updatedAt)}`;
    }
    if (job.finishedAt) {
      return `scraped ${this.timeAgo(job.finishedAt)} · ${this.formatMinute(job.finishedAt)}`;
    }
    return `updated ${this.timeAgo(job.updatedAt ?? job.startedAt)} · ${this.formatMinute(job.updatedAt ?? job.startedAt)}`;
  }

  stepDetail(row: InfluencerRow, stepKey: string): string {
    const job = this.latestJobFor(row.username);
    if (!job) {
      if (row.status === 'success') {
        if (stepKey === 'open') {
          return 'history';
        }
        if (stepKey === 'read' && row.posts > 0) {
          return `${row.posts} total`;
        }
        if (stepKey === 'extract' && row.mentions > 0) {
          return `${row.mentions} total`;
        }
        if (stepKey === 'store') {
          return 'complete';
        }
      }
      return stepKey === 'open' ? 'waiting' : '—';
    }

    switch (stepKey) {
      case 'open':
        return job.startedAt ? this.formatMinute(job.startedAt) : 'queued';
      case 'read':
        return job.postsSeen > 0 ? `${job.postsSeen}/50 posts scanned` : this.jobTerminal(job) ? '0/50 posts scanned' : 'timeline cursor';
      case 'extract':
        if (job.mentionsFound > 0) {
          return `${job.mentionsFound} mentions`;
        }
        return job.postsSeen > 0 || this.jobTerminal(job) ? 'checked' : 'waiting';
      case 'store':
        if (job.postsStored > 0) {
          return `${job.postsStored} stored`;
        }
        return this.jobTerminal(job) ? '0 stored' : 'waiting';
      default:
        return '—';
    }
  }

  scrapeDurationFor(job: JobHistoryRow | null): string {
    if (!job?.startedAt) {
      return '—';
    }
    const start = new Date(job.startedAt).getTime();
    const end = new Date(job.finishedAt ?? job.updatedAt ?? job.startedAt).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
      return '—';
    }
    const seconds = Math.round((end - start) / 1000);
    if (seconds < 60) {
      return `${seconds}s`;
    }
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    return `${minutes}m ${String(rest).padStart(2, '0')}s`;
  }

  detailDataFor(row: InfluencerRow, job: JobHistoryRow | null): string {
    if (job) {
      return `${job.postsSeen} seen · ${job.postsStored} stored · ${job.mentionsFound} mentions`;
    }
    return `${row.posts} total posts · ${row.mentions} total mentions`;
  }

  formatFollowers(value: number | null): string {
    if (value == null || !Number.isFinite(value)) {
      return 'followers —';
    }
    if (value >= 1_000_000) {
      return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M followers`;
    }
    if (value >= 1_000) {
      return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}K followers`;
    }
    return `${value} followers`;
  }

  rowLightClass(row: InfluencerRow): string {
    if (row.status === 'success') {
      return 'complete';
    }
    if (row.status === 'failed') {
      return 'failed';
    }
    if (row.status === 'running') {
      return 'running';
    }
    return 'idle';
  }

  readonly projectedDuration = computed(() => {
    const mode = this.mode();
    if (mode === 'Safe') {
      return '3-6h';
    }
    if (mode === 'Fast') {
      return '60-90m';
    }
    return '<60m target';
  });

  ngOnInit(): void {
    void this.loadSnapshot();
    this.connectLiveEvents();
    this.liveWatchdogTimer = setInterval(() => this.checkLiveHealth(), this.liveWatchdogEveryMs);
  }

  ngOnDestroy(): void {
    this.clearScheduledSnapshotLoad();
    this.stopActiveRunWatch();
    this.stopFallbackPolling();
    this.liveEvents?.close();
    if (this.liveWatchdogTimer) {
      clearInterval(this.liveWatchdogTimer);
    }
  }

  async startRun(): Promise<void> {
    if (this.source() === 'api') {
      try {
        await this.api.startRun(this.mode());
        this.startActiveRunWatch();
        await this.loadSnapshot();
        return;
      } catch {
        this.source.set('mock');
      }
    }

    this.status.set('running');
    this.pushEvent('info', `Started ${this.mode()} run`);
  }

  async scrapeBatch(): Promise<void> {
    const targets = this.liveRows()
      .filter((row) => row.enabled)
      .slice(0, this.quickScrapeTargetCount)
      .map((row) => row.username);
    if (targets.length === 0) {
      return;
    }

    this.status.set('running');
    this.targetCount.set(targets.length);
    this.pushEvent('info', `Scraping ${targets.length} handles`);
    if (this.source() === 'api') {
      try {
        await this.api.startRun('Fast', targets);
        this.startActiveRunWatch();
        await this.loadSnapshot();
      } catch {
        this.source.set('mock');
      }
    }
  }

  preventRowFocus(event: MouseEvent): void {
    event.preventDefault();
  }

  selectRow(row: InfluencerRow, event?: Event): void {
    event?.preventDefault();
    (event?.currentTarget as HTMLElement | null)?.blur();
    const scrollState = this.captureScrollState();

    if (this.selectedUsername() === row.username) {
      this.selectedUsername.set(null);
      this.restoreScrollState(scrollState);
      return;
    }

    this.selectedUsername.set(row.username);
    this.restoreScrollState(scrollState);
    void this.loadPostsForInfluencer(row.username);
  }

  latestJobFor(username: string): JobHistoryRow | null {
    const recentJob = this.latestJobByUsername().get(username.toLowerCase());
    if (recentJob) {
      return recentJob;
    }

    const row = this.influencers().find((item) => item.username.toLowerCase() === username.toLowerCase());
    return row ? this.lastScrapeJobFromRow(row) : null;
  }

  recentPostsFor(username: string): RecentPostRow[] {
    const selectedRows = this.selectedPostsByUsername()[username.toLowerCase()];
    if (selectedRows) {
      return selectedRows;
    }

    return this.recentPostsByUsername().get(username.toLowerCase()) ?? [];
  }

  primaryTimeFor(job: JobHistoryRow | null): string {
    return this.formatDateTime(job?.finishedAt ?? job?.startedAt ?? job?.updatedAt ?? null);
  }

  formatMinute(value: string | null): string {
    if (!value) {
      return '—';
    }
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: '2-digit',
      hour: 'numeric',
      minute: '2-digit'
    }).format(new Date(value));
  }

  formatDateTime(value: string | null): string {
    if (!value) {
      return '—';
    }
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: '2-digit',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit'
    }).format(new Date(value));
  }

  timeAgo(value: string | null): string {
    if (!value) {
      return '—';
    }
    const timestamp = new Date(value).getTime();
    if (!Number.isFinite(timestamp)) {
      return '—';
    }
    const seconds = Math.max(0, Math.round((this.traceClock() - timestamp) / 1000));
    if (seconds < 10) {
      return 'just now';
    }
    if (seconds < 60) {
      return `${seconds}s ago`;
    }
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) {
      return `${minutes}m ago`;
    }
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    if (hours < 24) {
      return rest ? `${hours}h ${rest}m ago` : `${hours}h ago`;
    }
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  compactNumber(value: number | null): string {
    if (value === null || !Number.isFinite(value)) {
      return '—';
    }
    return new Intl.NumberFormat('en-US', {
      notation: 'compact',
      maximumFractionDigits: 1
    }).format(value);
  }

  async pauseRun(): Promise<void> {
    if (this.source() === 'api') {
      try {
        await this.api.togglePause();
        await this.loadSnapshot();
        return;
      } catch {
        this.source.set('mock');
      }
    }

    this.status.set(this.status() === 'paused' ? 'running' : 'paused');
    this.pushEvent('warn', this.status() === 'paused' ? 'Run paused by operator' : 'Run resumed by operator');
  }

  setMode(mode: RunMode): void {
    this.mode.set(mode);
    this.pushEvent('info', `Mode set to ${mode}`);
  }

  resetPage(): void {
    this.pageIndex.set(0);
    this.clearSelection();
  }

  previousPage(): void {
    this.clearScheduledSnapshotLoad();
    this.clearSelection();
    this.pageIndex.update((value) => Math.max(0, value - 1));
    void this.loadSnapshot();
  }

  nextPage(): void {
    this.clearScheduledSnapshotLoad();
    this.clearSelection();
    this.pageIndex.update((value) => Math.min(this.pageCount() - 1, value + 1));
    void this.loadSnapshot();
  }

  onFilterText(value: string): void {
    this.filterText.set(value);
    this.resetPage();
    this.scheduleSnapshotLoad();
  }

  onFilterStatus(value: 'all' | UiJobStatus): void {
    this.clearScheduledSnapshotLoad();
    this.filterStatus.set(value);
    this.resetPage();
    void this.loadSnapshot();
  }

  onPriorityOnly(value: boolean): void {
    this.clearScheduledSnapshotLoad();
    this.priorityOnly.set(value);
    this.resetPage();
    void this.loadSnapshot();
  }

  onPageSize(value: number | string): void {
    this.clearScheduledSnapshotLoad();
    this.pageSize.set(Number(value));
    this.resetPage();
    void this.loadSnapshot();
  }

  isSelected(row: InfluencerRow): boolean {
    return this.selectedInfluencers().has(row.username);
  }

  onToggleRowSelection(row: InfluencerRow, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.selectedInfluencers.update((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(row.username);
      } else {
        next.delete(row.username);
      }
      return next;
    });
  }

  onTogglePageSelection(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    if (checked) {
      this.selectCurrentPage();
    } else {
      this.clearSelection();
    }
  }

  selectCurrentPage(): void {
    this.selectedInfluencers.set(new Set(this.pageUsernames()));
  }

  clearSelection(): void {
    this.selectedInfluencers.set(new Set<string>());
  }

  async addInfluencer(): Promise<void> {
    const username = this.newInfluencer().trim().replace(/^@/, '');
    if (!username) {
      return;
    }

    if (this.source() === 'api') {
      try {
        await this.api.addInfluencer(username);
        this.newInfluencer.set('');
        await this.loadSnapshot();
        return;
      } catch {
        this.source.set('mock');
      }
    }

    if (this.influencers().some((item) => item.username.toLowerCase() === username.toLowerCase())) {
      this.pushEvent('warn', `@${username} is already in the list`);
      return;
    }

    this.influencers.update((rows) => [
      {
        username,
        displayName: null,
        followersCount: null,
        profileImageUrl: null,
        priority: true,
        enabled: true,
        status: 'queued',
        posts: 0,
        mentions: 0,
        score: null,
        slot: null,
        outcome: 'Unknown',
        outcomeCode: null,
        lastEvent: 'Added live by operator',
        ...this.emptyLastScrape()
      },
      ...rows
    ]);
    this.newInfluencer.set('');
    this.pushEvent('info', `@${username} added and queued`);
  }

  async importInfluencers(): Promise<void> {
    const usernames = this.bulkInfluencers()
      .split(/[\n,;\s]+/)
      .map((item) => item.trim().replace(/^@/, ''))
      .filter(Boolean);
    if (usernames.length === 0) {
      return;
    }

    if (this.source() === 'api') {
      try {
        const result = await this.api.importInfluencers(usernames, this.mode() !== 'Safe');
        this.bulkInfluencers.set('');
        await this.loadSnapshot();
        this.pushEvent('info', `Imported ${result.added}; skipped ${result.skipped}`);
        return;
      } catch {
        this.source.set('mock');
      }
    }

    const existing = new Set(this.influencers().map((item) => item.username.toLowerCase()));
    const added = usernames.filter((username) => !existing.has(username.toLowerCase()));
    this.influencers.update((rows) => [
      ...added.map((username) => ({
        username,
        displayName: null,
        followersCount: null,
        profileImageUrl: null,
        priority: this.mode() !== 'Safe',
        enabled: true,
        status: 'queued' as const,
        posts: 0,
        mentions: 0,
        score: null,
        slot: null,
        outcome: 'Unknown' as const,
        outcomeCode: null,
        lastEvent: 'Imported by operator',
        ...this.emptyLastScrape()
      })),
      ...rows
    ]);
    this.bulkInfluencers.set('');
    this.pushEvent('info', `Imported ${added.length}; skipped ${usernames.length - added.length}`);
  }

  async exportInfluencers(enabledOnly: boolean): Promise<void> {
    let rows: ReadonlyArray<Pick<InfluencerJob, 'username' | 'enabled'>>;
    if (this.source() === 'api') {
      try {
        rows = await this.api.listInfluencers();
      } catch {
        this.source.set('mock');
        rows = this.influencers();
      }
    } else {
      rows = this.influencers();
    }

    const handles = rows
      .filter((row) => !enabledOnly || row.enabled)
      .map((row) => `@${row.username.replace(/^@/, '')}`)
      .sort((left, right) => left.localeCompare(right));

    if (handles.length === 0) {
      this.pushEvent('warn', `No ${enabledOnly ? 'enabled ' : ''}influencers to export`);
      return;
    }

    const suffix = enabledOnly ? 'enabled' : 'all';
    this.downloadTextFile(`ithac-${suffix}-influencers-${this.exportStamp()}.txt`, `${handles.join('\n')}\n`);
    this.pushEvent('info', `Exported ${handles.length} ${suffix} handles`);
  }

  async toggleEnabled(row: InfluencerRow): Promise<void> {
    if (this.source() === 'api') {
      try {
        await this.api.patchInfluencer(row.username, { enabled: !row.enabled });
        await this.loadSnapshot();
        return;
      } catch {
        this.source.set('mock');
      }
    }

    this.influencers.update((rows) =>
      rows.map((item) =>
        item.username === row.username
          ? {
              ...item,
              enabled: !item.enabled,
              status: item.enabled ? 'paused' : 'queued',
              lastEvent: item.enabled ? 'Disabled by operator' : 'Re-enabled by operator'
            }
          : item
      )
    );
  }

  async remove(row: InfluencerRow): Promise<void> {
    if (this.source() === 'api') {
      try {
        await this.api.removeInfluencer(row.username);
        await this.loadSnapshot();
        return;
      } catch {
        this.source.set('mock');
      }
    }

    this.influencers.update((rows) => rows.filter((item) => item.username !== row.username));
    this.pushEvent('warn', `@${row.username} removed from queue`);
  }

  async retry(row: InfluencerRow): Promise<void> {
    if (this.source() === 'api') {
      try {
        await this.api.retryInfluencer(row.username);
        await this.loadSnapshot();
        return;
      } catch {
        this.source.set('mock');
      }
    }

    this.influencers.update((rows) =>
      rows.map((item) =>
        item.username === row.username
          ? { ...item, status: 'queued', lastEvent: 'Retry queued by operator' }
          : item
      )
    );
    this.pushEvent('info', `@${row.username} retry queued`);
  }

  async bulkSetEnabled(enabled: boolean): Promise<void> {
    const usernames = this.selectedCurrentPageUsernames();
    if (usernames.length === 0 || this.bulkActionRunning()) {
      return;
    }

    this.bulkActionRunning.set(true);
    try {
      if (this.source() === 'api') {
        try {
          for (const username of usernames) {
            await this.api.patchInfluencer(username, { enabled });
          }
          this.clearSelection();
          await this.loadSnapshot();
          this.pushEvent('info', `${enabled ? 'Enabled' : 'Paused'} ${usernames.length} selected`);
          return;
        } catch {
          this.source.set('mock');
        }
      }

      this.influencers.update((rows) =>
        rows.map((item) =>
          usernames.includes(item.username)
            ? {
                ...item,
                enabled,
                status: enabled ? 'queued' : 'paused',
                lastEvent: enabled ? 'Bulk re-enabled by operator' : 'Bulk disabled by operator'
              }
            : item
        )
      );
      this.clearSelection();
      this.pushEvent('info', `${enabled ? 'Enabled' : 'Paused'} ${usernames.length} selected`);
    } finally {
      this.bulkActionRunning.set(false);
    }
  }

  async bulkRetry(): Promise<void> {
    const usernames = this.selectedCurrentPageUsernames();
    if (usernames.length === 0 || this.bulkActionRunning()) {
      return;
    }

    this.bulkActionRunning.set(true);
    try {
      if (this.source() === 'api') {
        try {
          for (const username of usernames) {
            await this.api.retryInfluencer(username);
          }
          this.clearSelection();
          await this.loadSnapshot();
          this.pushEvent('info', `Retry queued for ${usernames.length} selected`);
          return;
        } catch {
          this.source.set('mock');
        }
      }

      this.influencers.update((rows) =>
        rows.map((item) =>
          usernames.includes(item.username)
            ? { ...item, status: 'queued', lastEvent: 'Bulk retry queued by operator' }
            : item
        )
      );
      this.clearSelection();
      this.pushEvent('info', `Retry queued for ${usernames.length} selected`);
    } finally {
      this.bulkActionRunning.set(false);
    }
  }

  async toggleSession(row: SessionRow): Promise<void> {
    if (this.source() === 'api') {
      try {
        await this.api.patchSession(row.name, { enabled: !row.enabled });
        await this.loadSnapshot();
        return;
      } catch {
        this.source.set('mock');
      }
    }

    this.sessions.update((rows) =>
      rows.map((item) =>
        item.name === row.name
          ? { ...item, enabled: !item.enabled, health: item.enabled ? 'disabled' : 'available' }
          : item
      )
    );
  }

  selectSession(row: SessionRow): void {
    this.selectedSessionName.set(row.name);
  }

  async cooldownSession(row: SessionRow): Promise<void> {
    if (this.source() === 'api') {
      try {
        await this.api.patchSession(row.name, { cooldownMinutes: 15 });
        await this.loadSnapshot();
        return;
      } catch {
        this.source.set('mock');
      }
    }

    this.sessions.update((rows) =>
      rows.map((item) =>
        item.name === row.name
          ? { ...item, health: 'cooling', cooldownUntil: new Date(Date.now() + 15 * 60_000).toISOString() }
          : item
      )
    );
  }

  async toggleProxy(row: ProxyRow): Promise<void> {
    if (this.source() === 'api') {
      try {
        await this.api.patchProxy(row.name, { enabled: !row.enabled });
        await this.loadSnapshot();
        return;
      } catch {
        this.source.set('mock');
      }
    }

    this.proxies.update((rows) =>
      rows.map((item) =>
        item.name === row.name
          ? { ...item, enabled: !item.enabled, health: item.enabled ? 'disabled' : 'available' }
          : item
      )
    );
  }

  selectProxy(row: ProxyRow): void {
    this.selectedProxyName.set(row.name);
  }

  async cooldownProxy(row: ProxyRow): Promise<void> {
    if (this.source() === 'api') {
      try {
        await this.api.patchProxy(row.name, { cooldownMinutes: 15 });
        await this.loadSnapshot();
        return;
      } catch {
        this.source.set('mock');
      }
    }

    this.proxies.update((rows) =>
      rows.map((item) =>
        item.name === row.name
          ? { ...item, health: 'cooling', cooldownUntil: new Date(Date.now() + 15 * 60_000).toISOString() }
          : item
      )
    );
  }

  private async loadSnapshot(): Promise<void> {
    if (this.snapshotLoading) {
      return;
    }

    this.snapshotLoading = true;
    const scrollState = this.captureScrollState();
    try {
      const snapshot = await this.api.snapshot(this.pageParams());
      this.loadError.set(null);
      this.applySnapshot(snapshot);
      this.restoreScrollState(scrollState);
      if (this.status() === 'running' || this.activeScraper()) {
        this.startActiveRunWatch();
      }
      this.lastRefreshedAt.set(new Date().toISOString());
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load live scraper data';
      this.loadError.set(message);
      this.pushEvent('error', message);
    } finally {
      this.snapshotLoading = false;
    }
  }

  private connectLiveEvents(): void {
    const events = this.api.liveEvents();
    if (!events) {
      this.liveTransport.set('polling');
      this.startFallbackPolling();
      return;
    }

    this.liveEvents = events;
    this.lastLiveSignalAt = Date.now();
    this.liveTransport.set('sse');
    events.onmessage = (message) => {
      this.lastLiveSignalAt = Date.now();
      this.liveTransport.set('sse');
      this.stopFallbackPolling();
      const item = this.parseLiveEvent(message.data);
      if (item?.type === 'state') {
        void this.loadSnapshot();
      }
    };
    events.onerror = () => {
      this.liveTransport.set('polling');
      this.startFallbackPolling();
    };
  }

  private checkLiveHealth(): void {
    this.traceClock.set(Date.now());
    if (!this.liveEvents) {
      return;
    }
    if (Date.now() - this.lastLiveSignalAt > this.liveStaleAfterMs) {
      this.liveTransport.set('polling');
      this.startFallbackPolling();
    }
  }

  private startFallbackPolling(): void {
    if (this.refreshTimer) {
      return;
    }
    this.refreshTimer = setInterval(() => {
      void this.loadSnapshot();
    }, this.fallbackRefreshEveryMs);
  }

  private stopFallbackPolling(): void {
    if (!this.refreshTimer) {
      return;
    }
    clearInterval(this.refreshTimer);
    this.refreshTimer = undefined;
  }

  private startActiveRunWatch(): void {
    if (this.activeRunTimer) {
      return;
    }
    this.activeRunTimer = setInterval(() => {
      this.traceClock.set(Date.now());
      if (this.status() === 'running') {
        void this.loadSnapshot().then(() => {
          this.traceClock.set(Date.now());
          if (this.status() !== 'running' && !this.activeScraper()) {
            this.stopActiveRunWatch();
          }
        });
        return;
      }

      if (!this.activeScraper()) {
        this.stopActiveRunWatch();
      }
    }, 1000);
  }

  private stopActiveRunWatch(): void {
    if (!this.activeRunTimer) {
      return;
    }
    clearInterval(this.activeRunTimer);
    this.activeRunTimer = undefined;
  }

  private isRecentScraperJob(job: JobHistoryRow): boolean {
    const timestamp = this.jobActivityTime(job);
    return timestamp > 0 && this.traceClock() - timestamp < this.scraperTraceWindowMs;
  }

  private jobActivityTime(job: JobHistoryRow): number {
    const values = [job.finishedAt, job.updatedAt, job.startedAt]
      .map((value) => value ? new Date(value).getTime() : 0)
      .filter((value) => Number.isFinite(value));
    return Math.max(0, ...values);
  }

  private jobTerminal(job: JobHistoryRow): boolean {
    return job.status === 'success' || job.status === 'failed';
  }

  private scheduleSnapshotLoad(): void {
    this.clearScheduledSnapshotLoad();
    this.filterTimer = setTimeout(() => {
      this.filterTimer = undefined;
      void this.loadSnapshot();
    }, 250);
  }

  private captureScrollState(): { listTop: number | null; windowX: number; windowY: number } {
    if (typeof document === 'undefined' || typeof window === 'undefined') {
      return { listTop: null, windowX: 0, windowY: 0 };
    }

    return {
      listTop: document.querySelector<HTMLElement>('.list')?.scrollTop ?? null,
      windowX: window.scrollX,
      windowY: window.scrollY
    };
  }

  private restoreScrollState(state: { listTop: number | null; windowX: number; windowY: number }): void {
    if (typeof document === 'undefined' || typeof window === 'undefined') {
      return;
    }

    requestAnimationFrame(() => {
      if (state.listTop !== null) {
        const list = document.querySelector<HTMLElement>('.list');
        if (list) {
          list.scrollTop = state.listTop;
        }
      }
      window.scrollTo(state.windowX, state.windowY);
    });
  }

  private clearScheduledSnapshotLoad(): void {
    if (!this.filterTimer) {
      return;
    }
    clearTimeout(this.filterTimer);
    this.filterTimer = undefined;
  }

  private parseLiveEvent(data: string): LiveEventMessage | null {
    try {
      return JSON.parse(data) as LiveEventMessage;
    } catch {
      return null;
    }
  }

  private applySnapshot(snapshot: CockpitSnapshot): void {
    this.source.set(snapshot.source);
    this.mode.set(snapshot.run.mode);
    this.status.set(this.mapRunStatus(snapshot.run.status));
    this.targetCount.set(snapshot.run.targetCount);
    this.total.set(snapshot.run.loadedCount);
    this.enabled.set(snapshot.run.enabledCount);
    this.completed.set(snapshot.run.successCount);
    this.running.set(snapshot.run.runningCount);
    this.failed.set(snapshot.run.failedCount);
    this.filteredTotal.set(snapshot.influencerPage.total);
    this.pageIndex.set(snapshot.influencerPage.pageIndex);
    this.pageSize.set(snapshot.influencerPage.pageSize);
    this.influencers.set(snapshot.influencerPage.items.map((item) => this.mapInfluencer(item)));
    this.pruneSelectionToCurrentPage();
    this.slots.set(
      snapshot.slots.map((item) => ({
        ...item,
        health: this.mapHealth(item.health)
      }))
    );
    this.sessions.set(snapshot.sessions.map((item) => this.mapSession(item)));
    this.proxies.set(snapshot.proxies.map((item) => this.mapProxy(item)));
    this.recentPosts.set(snapshot.posts.map((item) => this.mapRecentPost(item)));
    this.scores.set(
      snapshot.scores.map((item) => ({
        username: item.username,
        score: item.score,
        mentions: item.mentions,
        outcome: item.lastOutcome,
        explanation: item.explanation
      }))
    );
    this.jobHistory.set(snapshot.jobs.map((item) => this.mapJobHistory(item)));
    this.runHistory.set(snapshot.runs.map((item) => this.mapRunHistory(item)));
    this.events.set(snapshot.events);
  }

  private pageParams(): InfluencerPageParams {
    return {
      query: this.filterText(),
      status: this.filterStatus(),
      priorityOnly: this.priorityOnly(),
      pageIndex: this.pageIndex(),
      pageSize: this.pageSize()
    };
  }

  private selectedCurrentPageUsernames(): string[] {
    const selected = this.selectedInfluencers();
    return this.pageUsernames().filter((username) => selected.has(username));
  }

  private pruneSelectionToCurrentPage(): void {
    const visible = new Set(this.pageUsernames());
    const selected = this.selectedInfluencers();
    const next = new Set([...selected].filter((username) => visible.has(username)));
    if (next.size !== selected.size) {
      this.selectedInfluencers.set(next);
    }
  }

  private exportStamp(): string {
    return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  }

  private downloadTextFile(filename: string, content: string): void {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  private emptyLastScrape(): Pick<
    InfluencerRow,
    | 'lastScrapeRunId'
    | 'lastScrapeStatus'
    | 'lastPostsSeen'
    | 'lastPostsStored'
    | 'lastMentionsFound'
    | 'lastScrapeStartedAt'
    | 'lastScrapeFinishedAt'
    | 'lastScrapeUpdatedAt'
    | 'lastScrapeSessionName'
    | 'lastScrapeProxyName'
    | 'lastScrapeOutcomeMessage'
    | 'lastScrapeErrorMessage'
  > {
    return {
      lastScrapeRunId: null,
      lastScrapeStatus: null,
      lastPostsSeen: null,
      lastPostsStored: null,
      lastMentionsFound: null,
      lastScrapeStartedAt: null,
      lastScrapeFinishedAt: null,
      lastScrapeUpdatedAt: null,
      lastScrapeSessionName: null,
      lastScrapeProxyName: null,
      lastScrapeOutcomeMessage: null,
      lastScrapeErrorMessage: null
    };
  }

  private lastScrapeJobFromRow(row: InfluencerRow): JobHistoryRow | null {
    const updatedAt = row.lastScrapeUpdatedAt ?? row.lastScrapeFinishedAt ?? row.lastScrapeStartedAt;
    if (!updatedAt) {
      return null;
    }

    const status = row.lastScrapeStatus ?? row.status;
    const resource = [row.lastScrapeSessionName, row.lastScrapeProxyName].filter(Boolean).join(' · ') || 'unassigned';
    return {
      id: -this.stableUsernameId(row.username),
      username: row.username,
      runId: row.lastScrapeRunId ?? 0,
      status,
      attempt: '—',
      slot: row.slot === null ? '—' : `S${row.slot}`,
      resource,
      outcome: row.outcomeCode || row.outcome,
      counters: `${row.lastPostsStored ?? 0}/${row.lastPostsSeen ?? 0} posts · ${row.lastMentionsFound ?? 0} mentions`,
      postsSeen: row.lastPostsSeen ?? 0,
      postsStored: row.lastPostsStored ?? 0,
      mentionsFound: row.lastMentionsFound ?? 0,
      outcomeMessage: row.lastScrapeOutcomeMessage ?? row.lastEvent,
      errorMessage: row.lastScrapeErrorMessage,
      startedAt: row.lastScrapeStartedAt,
      finishedAt: row.lastScrapeFinishedAt,
      updatedAt
    };
  }

  private stableUsernameId(username: string): number {
    let hash = 0;
    for (const char of username.toLowerCase()) {
      hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    }
    return Math.max(1, hash);
  }

  private mapInfluencer(item: InfluencerJob): InfluencerRow {
    return {
      username: item.username,
      displayName: item.displayName ?? null,
      followersCount: item.followersCount ?? null,
      profileImageUrl: item.profileImageUrl ?? null,
      priority: item.priority,
      enabled: item.enabled,
      status: this.mapJobStatus(item.status),
      posts: item.posts,
      mentions: item.mentions,
      score: item.score,
      slot: item.slot,
      outcome: item.lastOutcome,
      outcomeCode: item.lastOutcomeCode,
      lastEvent: item.lastEvent,
      lastScrapeRunId: item.lastScrapeRunId ?? null,
      lastScrapeStatus: item.lastScrapeStatus ? this.mapJobStatus(item.lastScrapeStatus) : null,
      lastPostsSeen: item.lastPostsSeen ?? null,
      lastPostsStored: item.lastPostsStored ?? null,
      lastMentionsFound: item.lastMentionsFound ?? null,
      lastScrapeStartedAt: item.lastScrapeStartedAt ?? null,
      lastScrapeFinishedAt: item.lastScrapeFinishedAt ?? null,
      lastScrapeUpdatedAt: item.lastScrapeUpdatedAt ?? null,
      lastScrapeSessionName: item.lastScrapeSessionName ?? null,
      lastScrapeProxyName: item.lastScrapeProxyName ?? null,
      lastScrapeOutcomeMessage: item.lastScrapeOutcomeMessage ?? null,
      lastScrapeErrorMessage: item.lastScrapeErrorMessage ?? null
    };
  }

  private mapRunStatus(status: ApiRunStatus): UiRunStatus {
    if (status === 'Running') {
      return 'running';
    }
    if (status === 'Paused') {
      return 'paused';
    }
    return 'ready';
  }

  private mapJobStatus(status: ApiJobStatus): UiJobStatus {
    if (status === 'Running') {
      return 'running';
    }
    if (status === 'Success') {
      return 'success';
    }
    if (status === 'Failed') {
      return 'failed';
    }
    if (status === 'Paused' || status === 'Removed') {
      return 'paused';
    }
    return 'queued';
  }

  private mapHealth(health: ApiHealth): SlotRow['health'] {
    if (health === 'Available') {
      return 'available';
    }
    if (health === 'CoolingDown') {
      return 'cooling';
    }
    if (health === 'LoginRequired') {
      return 'login';
    }
    if (health === 'Disabled') {
      return 'disabled';
    }
    return 'failed';
  }

  private mapSession(item: SessionResource): SessionRow {
    return {
      name: item.name,
      fileName: item.fileName,
      enabled: item.enabled,
      health: this.mapHealth(item.health),
      assignedProxy: item.assignedProxy,
      lastUsedAt: item.lastUsedAt,
      lastError: item.lastError,
      cooldownUntil: item.cooldownUntil,
      dailyJobCount: item.dailyJobCount
    };
  }

  private mapProxy(item: ProxyResource): ProxyRow {
    return {
      name: item.name,
      provider: item.provider,
      endpointRef: item.endpointRef,
      enabled: item.enabled,
      health: this.mapHealth(item.health),
      lastProbeAt: item.lastProbeAt,
      lastError: item.lastError,
      cooldownUntil: item.cooldownUntil
    };
  }

  private mapRecentPost(item: RecentPost): RecentPostRow {
    return {
      username: item.username,
      sourcePostId: item.sourcePostId,
      content: item.content,
      url: item.url,
      postedAt: item.postedAt,
      scrapedAt: item.scrapedAt,
      mentions: item.mentions.map((mention) => mention.symbol)
    };
  }

  private async loadPostsForInfluencer(username: string): Promise<void> {
    const scrollState = this.captureScrollState();
    try {
      const posts = await this.api.postsForInfluencer(username, 10);
      this.selectedPostsByUsername.update((current) => ({
        ...current,
        [username.toLowerCase()]: posts.map((item) => this.mapRecentPost(item))
      }));
    } catch {
      this.selectedPostsByUsername.update((current) => ({
        ...current,
        [username.toLowerCase()]: []
      }));
    } finally {
      this.restoreScrollState(scrollState);
    }
  }

  private mapJobHistory(item: JobHistory): JobHistoryRow {
    const resource = [item.sessionName, item.proxyName].filter(Boolean).join(' · ') || 'unassigned';
    return {
      id: item.id,
      username: item.username,
      runId: item.runId,
      status: this.mapJobStatus(item.status),
      attempt: `${item.attempt}/${item.maxAttempts}`,
      slot: item.slotId === null ? '—' : `S${item.slotId}`,
      resource,
      outcome: item.outcomeCode || item.outcome,
      counters: `${item.postsStored}/${item.postsSeen} posts · ${item.mentionsFound} mentions`,
      postsSeen: item.postsSeen,
      postsStored: item.postsStored,
      mentionsFound: item.mentionsFound,
      outcomeMessage: item.outcomeMessage,
      errorMessage: item.errorMessage,
      startedAt: item.startedAt,
      finishedAt: item.finishedAt,
      updatedAt: item.updatedAt
    };
  }

  private mapRunHistory(item: RunHistory): RunHistoryRow {
    return {
      id: item.id,
      mode: item.mode,
      status: this.mapRunStatus(item.status),
      targetCount: item.targetCount,
      counters: `${item.successCount} ok · ${item.runningCount} running · ${item.failedCount} failed · ${item.queuedCount} queued`,
      updatedAt: item.updatedAt
    };
  }

  private pushEvent(level: EventRow['level'], text: string): void {
    const now = new Date();
    const at = now.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    this.events.update((rows) => [{ at, level, text }, ...rows].slice(0, 8));
  }
}
