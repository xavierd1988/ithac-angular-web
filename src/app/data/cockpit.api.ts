import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { MOCK_COCKPIT } from './cockpit.mock';
import {
  CockpitSnapshot,
  DashboardEvent,
  BulkInfluencerImportResult,
  InfluencerJob,
  InfluencerScore,
  JobHistory,
  ProxyResource,
  RecentPost,
  RunDashboard,
  RunHistory,
  RunMode,
  RuntimeSlot,
  SessionResource
} from './cockpit.types';

declare global {
  interface Window {
    ITHAC_API_BASE_URL?: string;
  }
}

const API_BASE_URL = resolveApiBaseUrl();

function resolveApiBaseUrl(): string {
  const configured = globalThis.window?.ITHAC_API_BASE_URL?.trim();
  if (configured) {
    return configured.replace(/\/+$/, '');
  }

  const location = globalThis.window?.location;
  if (!location) {
    return 'http://127.0.0.1:5088';
  }

  const isLocal = location.hostname === '127.0.0.1' || location.hostname === 'localhost';
  if (isLocal && (location.port === '4200' || location.port === '4300')) {
    return 'http://127.0.0.1:5088';
  }

  if (location.hostname === 'ithacapp.com' || location.hostname === 'www.ithacapp.com') {
    return 'http://178.105.42.115:8080';
  }

  return '';
}

function apiUrl(path: string): string {
  return `${API_BASE_URL}${path}`;
}

export interface InfluencerPageParams {
  query: string;
  status: string;
  priorityOnly: boolean;
  pageIndex: number;
  pageSize: number;
}

@Injectable({ providedIn: 'root' })
export class CockpitApi {
  private readonly http = inject(HttpClient);

  async snapshot(params?: InfluencerPageParams): Promise<CockpitSnapshot> {
    try {
      const [snapshot, posts, jobs] = await Promise.all([
        this.get<Omit<CockpitSnapshot, 'source'>>(`/api/dashboard/snapshot${this.pageQuery(params)}`),
        this.recentPosts(160),
        this.recentJobs(200)
      ]);
      return { ...snapshot, posts, jobs, source: 'api' };
    } catch {
      return this.legacySnapshot(params);
    }
  }

  async startRun(mode: RunMode, targetUsernames?: string[]): Promise<RunDashboard> {
    return this.post<RunDashboard>('/api/runs', { mode, targetUsernames });
  }

  async togglePause(): Promise<RunDashboard> {
    return this.post<RunDashboard>('/api/runs/current/pause', {});
  }

  async addInfluencer(username: string): Promise<InfluencerJob> {
    return this.post<InfluencerJob>('/api/influencers', { username, priority: true });
  }

  async listInfluencers(): Promise<InfluencerJob[]> {
    return this.get<InfluencerJob[]>('/api/influencers');
  }

  async importInfluencers(usernames: string[], priority: boolean): Promise<BulkInfluencerImportResult> {
    return this.post<BulkInfluencerImportResult>('/api/influencers/import', { usernames, priority });
  }

  async patchInfluencer(username: string, patch: { enabled?: boolean; priority?: boolean }): Promise<InfluencerJob> {
    return this.patch<InfluencerJob>(`/api/influencers/${encodeURIComponent(username)}`, patch);
  }

  async removeInfluencer(username: string): Promise<void> {
    await this.delete(`/api/influencers/${encodeURIComponent(username)}`);
  }

  async retryInfluencer(username: string): Promise<InfluencerJob> {
    return this.post<InfluencerJob>(`/api/influencers/${encodeURIComponent(username)}/retry`, {});
  }

  liveEvents(): EventSource | null {
    if (typeof EventSource === 'undefined') {
      return null;
    }

    return new EventSource(apiUrl('/api/live/events'));
  }

  async patchSession(name: string, patch: { enabled?: boolean; cooldownMinutes?: number }): Promise<SessionResource> {
    return this.patch<SessionResource>(`/api/sessions/${encodeURIComponent(name)}`, patch);
  }

  async patchProxy(name: string, patch: { enabled?: boolean; cooldownMinutes?: number }): Promise<ProxyResource> {
    return this.patch<ProxyResource>(`/api/proxies/${encodeURIComponent(name)}`, patch);
  }

  async recentPosts(take: number): Promise<RecentPost[]> {
    return this.get<RecentPost[]>(`/api/posts/recent?take=${take}`);
  }

  async recentJobs(take: number): Promise<JobHistory[]> {
    return this.get<JobHistory[]>(`/api/jobs/recent?take=${take}`);
  }

  private get<T>(path: string): Promise<T> {
    return firstValueFrom(this.http.get<T>(apiUrl(path)));
  }

  private async legacySnapshot(params?: InfluencerPageParams): Promise<CockpitSnapshot> {
    try {
      const [run, influencers, slots, sessions, proxies, events, posts, scores, jobs, runs] = await Promise.all([
        this.get<RunDashboard>('/api/runs/current'),
        this.get<InfluencerJob[]>('/api/influencers'),
        this.get<RuntimeSlot[]>('/api/slots'),
        this.get<SessionResource[]>('/api/sessions'),
        this.get<ProxyResource[]>('/api/proxies'),
        this.get<DashboardEvent[]>('/api/events'),
        this.get<RecentPost[]>('/api/posts/recent?take=160'),
        this.get<InfluencerScore[]>('/api/scores/influencers?take=8'),
        this.get<JobHistory[]>('/api/jobs/recent?take=200'),
        this.get<RunHistory[]>('/api/runs/history?take=5')
      ]);
      const page = this.localInfluencerPage(influencers, params);

      return { run, influencerPage: page, influencers, slots, sessions, proxies, events, posts, scores, jobs, runs, source: 'api' };
    } catch {
      return structuredClone(MOCK_COCKPIT);
    }
  }

  private pageQuery(params?: InfluencerPageParams): string {
    if (!params) {
      return '';
    }

    const query = new URLSearchParams({
      query: params.query,
      status: params.status,
      priorityOnly: String(params.priorityOnly),
      pageIndex: String(params.pageIndex),
      pageSize: String(params.pageSize)
    });
    return `?${query.toString()}`;
  }

  private localInfluencerPage(influencers: InfluencerJob[], params?: InfluencerPageParams) {
    const pageSize = params?.pageSize ?? 100;
    const pageIndex = params?.pageIndex ?? 0;
    const query = params?.query.trim().toLowerCase() ?? '';
    const status = params?.status ?? 'all';
    const priorityOnly = params?.priorityOnly ?? false;
    const filtered = influencers.filter((item) => {
      if (status !== 'all' && item.status.toLowerCase() !== status.toLowerCase()) {
        return false;
      }
      if (priorityOnly && !item.priority) {
        return false;
      }
      if (!query) {
        return true;
      }
      return [
        item.username,
        item.lastOutcome,
        item.lastOutcomeCode ?? '',
        item.lastEvent
      ].some((value) => value.toLowerCase().includes(query));
    });
    return {
      pageIndex,
      pageSize,
      total: filtered.length,
      items: filtered.slice(pageIndex * pageSize, pageIndex * pageSize + pageSize)
    };
  }

  private post<T>(path: string, body: unknown): Promise<T> {
    return firstValueFrom(this.http.post<T>(apiUrl(path), body));
  }

  private patch<T>(path: string, body: unknown): Promise<T> {
    return firstValueFrom(this.http.patch<T>(apiUrl(path), body));
  }

  private delete(path: string): Promise<unknown> {
    return firstValueFrom(this.http.delete(apiUrl(path)));
  }
}
