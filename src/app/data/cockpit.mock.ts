import { CockpitSnapshot } from './cockpit.types';

export const MOCK_COCKPIT: CockpitSnapshot = {
  source: 'mock',
  run: {
    id: 1,
    mode: 'Safe',
    status: 'Queued',
    targetCount: 2000,
    enabledCount: 4,
    loadedCount: 5,
    queuedCount: 1,
    runningCount: 1,
    successCount: 1,
    failedCount: 1,
    skippedCount: 0,
    startedAt: null,
    finishedAt: null
  },
  influencerPage: {
    pageIndex: 0,
    pageSize: 100,
    total: 5,
    items: [
      {
        id: 1,
        username: 'WatcherGuru',
        priority: true,
        enabled: true,
        status: 'Running',
        posts: 48,
        mentions: 9,
        score: 8.4,
        slot: 1,
        lastOutcome: 'Available',
        lastOutcomeCode: 'available',
        lastEvent: 'Timeline scan in progress'
      },
      {
        id: 2,
        username: 'lookonchain',
        priority: true,
        enabled: true,
        status: 'Success',
        posts: 61,
        mentions: 14,
        score: 9.1,
        slot: 2,
        lastOutcome: 'Available',
        lastOutcomeCode: 'available',
        lastEvent: 'Stored 14 crypto mentions'
      },
      {
        id: 3,
        username: 'CryptoKaleo',
        priority: false,
        enabled: true,
        status: 'Queued',
        posts: 0,
        mentions: 0,
        score: null,
        slot: null,
        lastOutcome: 'Unknown',
        lastOutcomeCode: null,
        lastEvent: 'Waiting for slot'
      },
      {
        id: 4,
        username: 'AltcoinDailyio',
        priority: false,
        enabled: true,
        status: 'Failed',
        posts: 0,
        mentions: 0,
        score: null,
        slot: 3,
        lastOutcome: 'ResourceUnavailable',
        lastOutcomeCode: 'resource.unavailable',
        lastEvent: 'Session cooling down'
      },
      {
        id: 5,
        username: 'Cointelegraph',
        priority: false,
        enabled: false,
        status: 'Paused',
        posts: 20,
        mentions: 3,
        score: 6.2,
        slot: null,
        lastOutcome: 'Disabled',
        lastOutcomeCode: 'disabled',
        lastEvent: 'Disabled by operator'
      }
    ]
  },
  slots: [
    { slot: 1, session: 'session_01', proxy: 'proxy-us-01', health: 'Available', current: 'WatcherGuru', throughput: 42 },
    { slot: 2, session: 'session_02', proxy: 'proxy-us-02', health: 'Available', current: 'lookonchain', throughput: 38 },
    { slot: 3, session: 'session_03', proxy: 'proxy-us-03', health: 'CoolingDown', current: 'AltcoinDailyio', throughput: 21 },
    { slot: 4, session: 'session_04', proxy: 'proxy-us-04', health: 'Available', current: 'idle', throughput: 0 }
  ],
  sessions: [
    { id: 1, name: 'session_01', fileName: 'session_01.json', enabled: true, health: 'Available', assignedProxy: 'proxy-us-01', lastUsedAt: new Date().toISOString(), lastError: null, cooldownUntil: null, dailyJobCount: 42 },
    { id: 2, name: 'session_02', fileName: 'session_02.json', enabled: true, health: 'Available', assignedProxy: 'proxy-us-02', lastUsedAt: new Date().toISOString(), lastError: null, cooldownUntil: null, dailyJobCount: 38 },
    { id: 3, name: 'session_03', fileName: 'session_03.json', enabled: true, health: 'CoolingDown', assignedProxy: 'proxy-us-03', lastUsedAt: new Date().toISOString(), lastError: 'Recent warning, cooling down', cooldownUntil: new Date(Date.now() + 14 * 60_000).toISOString(), dailyJobCount: 21 },
    { id: 4, name: 'session_04', fileName: 'session_04.json', enabled: true, health: 'Available', assignedProxy: 'proxy-us-04', lastUsedAt: null, lastError: null, cooldownUntil: null, dailyJobCount: 0 }
  ],
  proxies: [
    { id: 1, name: 'proxy-us-01', provider: 'operator-config', endpointRef: 'proxy_config:us-01', enabled: true, health: 'Available', lastProbeAt: new Date().toISOString(), lastError: null, cooldownUntil: null },
    { id: 2, name: 'proxy-us-02', provider: 'operator-config', endpointRef: 'proxy_config:us-02', enabled: true, health: 'Available', lastProbeAt: new Date().toISOString(), lastError: null, cooldownUntil: null },
    { id: 3, name: 'proxy-us-03', provider: 'operator-config', endpointRef: 'proxy_config:us-03', enabled: true, health: 'CoolingDown', lastProbeAt: new Date().toISOString(), lastError: 'Backoff after warning', cooldownUntil: new Date(Date.now() + 14 * 60_000).toISOString() },
    { id: 4, name: 'proxy-us-04', provider: 'operator-config', endpointRef: 'proxy_config:us-04', enabled: true, health: 'Available', lastProbeAt: null, lastError: null, cooldownUntil: null }
  ],
  posts: [
    {
      id: 1,
      username: 'lookonchain',
      sourcePostId: 'demo-1',
      content: 'BTC and ETH momentum update from the offline adapter path.',
      url: 'https://x.example/lookonchain/status/demo-1',
      postedAt: new Date(Date.now() - 12 * 60_000).toISOString(),
      scrapedAt: new Date(Date.now() - 11 * 60_000).toISOString(),
      contentHash: 'demo-hash-1',
      mentions: [
        { symbol: 'BTC', confidence: 0.97, source: 'demo', mentionedAt: new Date(Date.now() - 12 * 60_000).toISOString() },
        { symbol: 'ETH', confidence: 0.91, source: 'demo', mentionedAt: new Date(Date.now() - 12 * 60_000).toISOString() }
      ]
    }
  ],
  scores: [
    { id: 2, username: 'lookonchain', score: 9.1, posts: 61, mentions: 14, lastOutcome: 'Available', lastOutcomeCode: 'available', priority: true, explanation: 'outcome=Available · posts=61 · mentions=14 · priority' },
    { id: 1, username: 'WatcherGuru', score: 8.4, posts: 48, mentions: 9, lastOutcome: 'Available', lastOutcomeCode: 'available', priority: true, explanation: 'outcome=Available · posts=48 · mentions=9 · priority' },
    { id: 5, username: 'Cointelegraph', score: 6.2, posts: 20, mentions: 3, lastOutcome: 'Disabled', lastOutcomeCode: 'disabled', priority: false, explanation: 'outcome=Disabled · posts=20 · mentions=3' }
  ],
  jobs: [
    {
      id: 2,
      runId: 1,
      username: 'lookonchain',
      status: 'Success',
      priority: true,
      attempt: 1,
      maxAttempts: 2,
      slotId: 2,
      sessionName: 'session_02',
      proxyName: 'proxy-us-02',
      postsSeen: 61,
      postsStored: 61,
      mentionsFound: 14,
      outcome: 'Available',
      outcomeCode: 'available',
      outcomeMessage: 'Stored 14 crypto mentions',
      errorCode: null,
      errorMessage: null,
      startedAt: new Date(Date.now() - 7 * 60_000).toISOString(),
      finishedAt: new Date(Date.now() - 6 * 60_000).toISOString(),
      createdAt: new Date(Date.now() - 8 * 60_000).toISOString(),
      updatedAt: new Date(Date.now() - 6 * 60_000).toISOString()
    },
    {
      id: 4,
      runId: 1,
      username: 'AltcoinDailyio',
      status: 'Failed',
      priority: false,
      attempt: 1,
      maxAttempts: 2,
      slotId: 3,
      sessionName: 'session_03',
      proxyName: 'proxy-us-03',
      postsSeen: 0,
      postsStored: 0,
      mentionsFound: 0,
      outcome: 'ResourceUnavailable',
      outcomeCode: 'resource.unavailable',
      outcomeMessage: 'Session cooling down',
      errorCode: 'resource.unavailable',
      errorMessage: 'Session cooling down',
      startedAt: new Date(Date.now() - 3 * 60_000).toISOString(),
      finishedAt: new Date(Date.now() - 2 * 60_000).toISOString(),
      createdAt: new Date(Date.now() - 4 * 60_000).toISOString(),
      updatedAt: new Date(Date.now() - 2 * 60_000).toISOString()
    }
  ],
  runs: [
    {
      id: 1,
      mode: 'Safe',
      status: 'Queued',
      targetCount: 2000,
      queuedCount: 1,
      runningCount: 1,
      successCount: 1,
      failedCount: 1,
      skippedCount: 0,
      startedAt: null,
      finishedAt: null,
      updatedAt: new Date().toISOString()
    }
  ],
  events: [
    { at: '00:00:12', level: 'info', text: 'Run seeded with 2,000 enabled influencers' },
    { at: '00:01:04', level: 'info', text: 'Slot 1 started @WatcherGuru' },
    { at: '00:01:21', level: 'info', text: 'Slot 2 stored 14 mentions for @lookonchain' },
    { at: '00:02:03', level: 'warn', text: 'Slot 3 cooling down after session warning' },
    { at: '00:02:44', level: 'info', text: 'Queue remains live-editable during run' }
  ]
};
