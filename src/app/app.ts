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
  private readonly liveWatchdogEveryMs = 5000;
  private readonly liveStaleAfterMs = 20000;
  private refreshTimer: ReturnType<typeof setInterval> | undefined;
  private filterTimer: ReturnType<typeof setTimeout> | undefined;
  private liveWatchdogTimer: ReturnType<typeof setInterval> | undefined;
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
  readonly pageSize = signal(100);
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
  readonly scores = signal<ScoreRow[]>([]);
  readonly jobHistory = signal<JobHistoryRow[]>([]);
  readonly runHistory = signal<RunHistoryRow[]>([]);
  readonly events = signal<EventRow[]>([]);
  readonly lastRefreshedAt = signal<string | null>(null);
  readonly liveTransport = signal<'sse' | 'polling'>('polling');
  readonly selectedInfluencers = signal<ReadonlySet<string>>(new Set<string>());

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
  readonly pageSizes: ReadonlyArray<number> = [50, 100, 250];
  readonly selectedSession = computed(() =>
    this.sessions().find((item) => item.name === this.selectedSessionName()) ?? null);
  readonly selectedProxy = computed(() =>
    this.proxies().find((item) => item.name === this.selectedProxyName()) ?? null);
  readonly queuedCount = computed(() =>
    Math.max(0, this.total() - this.completed() - this.running() - this.failed()));
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
  readonly latestRunLabel = computed(() => {
    const run = this.latestRun();
    return run ? `Run #${run.id}` : 'No run';
  });
  readonly latestEventLevel = computed(() => this.latestEvent()?.level ?? 'quiet');
  readonly liveRows = computed(() => {
    const weight: Record<UiJobStatus, number> = {
      running: 0,
      failed: 1,
      queued: 2,
      success: 3,
      paused: 4
    };
    return [...this.pagedVisibleInfluencers()].sort((left, right) => {
      const statusDelta = weight[left.status] - weight[right.status];
      if (statusDelta !== 0) {
        return statusDelta;
      }
      if (left.priority !== right.priority) {
        return left.priority ? -1 : 1;
      }
      return left.username.localeCompare(right.username);
    });
  });

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
        await this.loadSnapshot();
        return;
      } catch {
        this.source.set('mock');
      }
    }

    this.status.set('running');
    this.pushEvent('info', `Started ${this.mode()} run`);
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

  onPageSize(value: number): void {
    this.clearScheduledSnapshotLoad();
    this.pageSize.set(value);
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
        priority: true,
        enabled: true,
        status: 'queued',
        posts: 0,
        mentions: 0,
        score: null,
        slot: null,
        outcome: 'Unknown',
        outcomeCode: null,
        lastEvent: 'Added live by operator'
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
        priority: this.mode() !== 'Safe',
        enabled: true,
        status: 'queued' as const,
        posts: 0,
        mentions: 0,
        score: null,
        slot: null,
        outcome: 'Unknown' as const,
        outcomeCode: null,
        lastEvent: 'Imported by operator'
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
    try {
      const snapshot = await this.api.snapshot(this.pageParams());
      this.applySnapshot(snapshot);
      this.lastRefreshedAt.set(new Date().toISOString());
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

  private scheduleSnapshotLoad(): void {
    this.clearScheduledSnapshotLoad();
    this.filterTimer = setTimeout(() => {
      this.filterTimer = undefined;
      void this.loadSnapshot();
    }, 250);
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

  private mapInfluencer(item: InfluencerJob): InfluencerRow {
    return {
      username: item.username,
      priority: item.priority,
      enabled: item.enabled,
      status: this.mapJobStatus(item.status),
      posts: item.posts,
      mentions: item.mentions,
      score: item.score,
      slot: item.slot,
      outcome: item.lastOutcome,
      outcomeCode: item.lastOutcomeCode,
      lastEvent: item.lastEvent
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
