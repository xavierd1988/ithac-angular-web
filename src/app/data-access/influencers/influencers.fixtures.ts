import { InfluencerProfile } from './influencers.types';

export const MOCK_INFLUENCERS: InfluencerProfile[] = [
  {
    id: 'ag-finance',
    displayName: 'AG Finance',
    handle: '@agfinancemoney',
    rank: 12,
    winRate: 68,
    averagePerformancePercent: 24.6,
    callsTracked: 143,
    totalScore: 3517.8,
    positiveCalls: 97,
    negativeCalls: 24,
    neutralCalls: 22,
    lastUpdated: new Date(Date.now() - 1000 * 60 * 20).toISOString(),
    specialties: ['Meme rotation', 'early social clusters', 'volume confirmation'],
    latestSignals: [
      {
        tokenSymbol: 'PEPE',
        verdict: 'GOOD TRADE',
        performancePercent: 24.6,
        calledAt: new Date(Date.now() - 1000 * 60 * 14).toISOString()
      },
      {
        tokenSymbol: 'BONK',
        verdict: 'GOOD TRADE',
        performancePercent: 18.2,
        calledAt: new Date(Date.now() - 1000 * 60 * 180).toISOString()
      }
    ]
  },
  {
    id: 'crypto-kd',
    displayName: 'Crypto KD',
    handle: '@crypto_kd',
    rank: 4,
    winRate: 74,
    averagePerformancePercent: 41.3,
    callsTracked: 211,
    totalScore: 8714.3,
    positiveCalls: 156,
    negativeCalls: 31,
    neutralCalls: 24,
    lastUpdated: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
    specialties: ['Momentum', 'high-volume breakouts', 'short-window timing'],
    latestSignals: [
      {
        tokenSymbol: 'WIF',
        verdict: 'SUPER TRADE',
        performancePercent: 41.3,
        calledAt: new Date(Date.now() - 1000 * 60 * 32).toISOString()
      },
      {
        tokenSymbol: 'SOL',
        verdict: 'GOOD TRADE',
        performancePercent: 13.9,
        calledAt: new Date(Date.now() - 1000 * 60 * 280).toISOString()
      }
    ]
  }
];
