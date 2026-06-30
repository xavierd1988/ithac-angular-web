export type RunMode = 'Safe' | 'Fast' | 'Burst';
export type ApiRunStatus = 'Queued' | 'Running' | 'Paused' | 'Completed' | 'Failed' | 'Cancelled';
export type UiRunStatus = 'ready' | 'running' | 'paused';
export type ApiJobStatus = 'Queued' | 'Running' | 'Success' | 'Failed' | 'Retry' | 'Paused' | 'Skipped' | 'Removed';
export type UiJobStatus = 'queued' | 'running' | 'success' | 'failed' | 'paused';
export type ApiHealth = 'Unknown' | 'Available' | 'CoolingDown' | 'LoginRequired' | 'Failed' | 'Disabled';
export type UiHealth = 'available' | 'cooling' | 'failed' | 'login' | 'disabled';
export type ApiScrapeOutcome =
  | 'Unknown'
  | 'Available'
  | 'NoPosts'
  | 'LoginRequired'
  | 'DoesNotExist'
  | 'Suspended'
  | 'Restricted'
  | 'Private'
  | 'RateLimited'
  | 'NetworkError'
  | 'Timeout'
  | 'AdapterError'
  | 'ResourceUnavailable'
  | 'Disabled';

export interface RunDashboard {
  id: number;
  mode: RunMode;
  status: ApiRunStatus;
  targetCount: number;
  enabledCount: number;
  loadedCount: number;
  queuedCount: number;
  runningCount: number;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface InfluencerJob {
  id: number;
  username: string;
  displayName?: string | null;
  followersCount?: number | null;
  profileImageUrl?: string | null;
  priority: boolean;
  enabled: boolean;
  status: ApiJobStatus;
  posts: number;
  mentions: number;
  score: number | null;
  slot: number | null;
  lastOutcome: ApiScrapeOutcome;
  lastOutcomeCode: string | null;
  lastEvent: string;
  lastScrapeRunId?: number | null;
  lastScrapeStatus?: ApiJobStatus | null;
  lastPostsSeen?: number | null;
  lastPostsStored?: number | null;
  lastMentionsFound?: number | null;
  lastScrapeStartedAt?: string | null;
  lastScrapeFinishedAt?: string | null;
  lastScrapeUpdatedAt?: string | null;
  lastScrapeSessionName?: string | null;
  lastScrapeProxyName?: string | null;
  lastScrapeOutcomeMessage?: string | null;
  lastScrapeErrorMessage?: string | null;
}

export interface InfluencerPage {
  pageIndex: number;
  pageSize: number;
  total: number;
  items: InfluencerJob[];
}

export interface BulkInfluencerImportResult {
  requested: number;
  added: number;
  skipped: number;
  addedUsernames: string[];
  skippedUsernames: string[];
}

export interface RuntimeSlot {
  slot: number;
  session: string;
  proxy: string;
  health: ApiHealth;
  current: string;
  throughput: number;
}

export interface SessionResource {
  id: number;
  name: string;
  fileName: string;
  enabled: boolean;
  health: ApiHealth;
  assignedProxy: string | null;
  lastUsedAt: string | null;
  lastError: string | null;
  cooldownUntil: string | null;
  dailyJobCount: number;
}

export interface ProxyResource {
  id: number;
  name: string;
  provider: string;
  endpointRef: string;
  enabled: boolean;
  health: ApiHealth;
  lastProbeAt: string | null;
  lastError: string | null;
  cooldownUntil: string | null;
}

export interface DashboardEvent {
  at: string;
  level: 'info' | 'warn' | 'error';
  text: string;
}

export interface LiveEventMessage {
  sequence: number;
  type: 'state' | 'heartbeat';
  reason: string;
  utc: string;
}

export interface CryptoMention {
  symbol: string;
  confidence: number;
  source: string;
  mentionedAt: string;
}

export interface RecentPost {
  id: number;
  username: string;
  sourcePostId: string;
  content: string;
  url: string;
  postedAt: string;
  scrapedAt: string;
  contentHash: string;
  mentions: CryptoMention[];
}

export interface InfluencerScore {
  id: number;
  username: string;
  score: number;
  posts: number;
  mentions: number;
  lastOutcome: ApiScrapeOutcome;
  lastOutcomeCode: string | null;
  priority: boolean;
  explanation: string;
}

export interface JobHistory {
  id: number;
  runId: number;
  username: string;
  status: ApiJobStatus;
  priority: boolean;
  attempt: number;
  maxAttempts: number;
  slotId: number | null;
  sessionName: string | null;
  proxyName: string | null;
  postsSeen: number;
  postsStored: number;
  mentionsFound: number;
  outcome: ApiScrapeOutcome;
  outcomeCode: string | null;
  outcomeMessage: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RunHistory {
  id: number;
  mode: RunMode;
  status: ApiRunStatus;
  targetCount: number;
  queuedCount: number;
  runningCount: number;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
}

export interface CockpitSnapshot {
  run: RunDashboard;
  influencerPage: InfluencerPage;
  influencers?: InfluencerJob[];
  slots: RuntimeSlot[];
  sessions: SessionResource[];
  proxies: ProxyResource[];
  events: DashboardEvent[];
  posts: RecentPost[];
  scores: InfluencerScore[];
  jobs: JobHistory[];
  runs: RunHistory[];
  source: 'api' | 'mock';
}

export interface InfluencerRow {
  username: string;
  displayName: string | null;
  followersCount: number | null;
  profileImageUrl: string | null;
  priority: boolean;
  enabled: boolean;
  status: UiJobStatus;
  posts: number;
  mentions: number;
  score: number | null;
  slot: number | null;
  outcome: ApiScrapeOutcome;
  outcomeCode: string | null;
  lastEvent: string;
  lastScrapeRunId: number | null;
  lastScrapeStatus: UiJobStatus | null;
  lastPostsSeen: number | null;
  lastPostsStored: number | null;
  lastMentionsFound: number | null;
  lastScrapeStartedAt: string | null;
  lastScrapeFinishedAt: string | null;
  lastScrapeUpdatedAt: string | null;
  lastScrapeSessionName: string | null;
  lastScrapeProxyName: string | null;
  lastScrapeOutcomeMessage: string | null;
  lastScrapeErrorMessage: string | null;
}

export interface SlotRow {
  slot: number;
  session: string;
  proxy: string;
  health: UiHealth;
  current: string;
  throughput: number;
}

export interface SessionRow {
  name: string;
  fileName: string;
  enabled: boolean;
  health: UiHealth;
  assignedProxy: string | null;
  lastUsedAt: string | null;
  lastError: string | null;
  cooldownUntil: string | null;
  dailyJobCount: number;
}

export interface ProxyRow {
  name: string;
  provider: string;
  endpointRef: string;
  enabled: boolean;
  health: UiHealth;
  lastProbeAt: string | null;
  lastError: string | null;
  cooldownUntil: string | null;
}

export interface EventRow {
  at: string;
  level: 'info' | 'warn' | 'error';
  text: string;
}

export interface RecentPostRow {
  username: string;
  sourcePostId: string;
  content: string;
  url: string;
  postedAt: string;
  scrapedAt: string;
  mentions: string[];
}

export interface ScoreRow {
  username: string;
  score: number;
  mentions: number;
  outcome: ApiScrapeOutcome;
  explanation: string;
}

export interface JobHistoryRow {
  id: number;
  username: string;
  runId: number;
  status: UiJobStatus;
  attempt: string;
  slot: string;
  resource: string;
  outcome: string;
  counters: string;
  postsSeen: number;
  postsStored: number;
  mentionsFound: number;
  outcomeMessage: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
}

export interface RunHistoryRow {
  id: number;
  mode: RunMode;
  status: UiRunStatus;
  targetCount: number;
  counters: string;
  updatedAt: string;
}
