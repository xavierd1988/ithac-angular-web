import { AlertSignal } from './alerts.types';

export const MOCK_ALERTS: AlertSignal[] = [
  {
    id: 'alert-pepe-001',
    tokenSymbol: 'PEPE',
    tokenName: 'Pepe',
    callerName: 'AG Finance',
    callerHandle: '@agfinancemoney',
    verdict: 'GOOD TRADE',
    rank: 12,
    winRate: 68,
    performancePercent: 24.6,
    mentionCount: 7,
    createdAt: new Date(Date.now() - 1000 * 60 * 14).toISOString(),
    summary: 'Cluster of historically strong callers mentioned PEPE in a tight window.',
    posts: [
      {
        id: 'post-1',
        handle: '@agfinancemoney',
        text: 'PEPE showing unusual social momentum again.',
        postedAt: new Date(Date.now() - 1000 * 60 * 18).toISOString()
      },
      {
        id: 'post-2',
        handle: '@cryptotrade_kd',
        text: 'Watching PEPE volume into the next hour.',
        postedAt: new Date(Date.now() - 1000 * 60 * 21).toISOString()
      }
    ],
    timex: [
      { label: 'T-45m', valuePercent: -1.2 },
      { label: 'T-30m', valuePercent: 2.4 },
      { label: 'T-15m', valuePercent: 8.1 },
      { label: 'Now', valuePercent: 14.8 }
    ],
    pricePoints: [
      { at: new Date(Date.now() - 1000 * 60 * 60).toISOString(), price: 0.000012, changePercent: 0, label: 'Open' },
      { at: new Date(Date.now() - 1000 * 60 * 42).toISOString(), price: 0.0000123, changePercent: 2.5, label: 'T+1' },
      { at: new Date(Date.now() - 1000 * 60 * 24).toISOString(), price: 0.0000131, changePercent: 9.2, label: 'T+2' },
      { at: new Date(Date.now() - 1000 * 60 * 5).toISOString(), price: 0.0000138, changePercent: 15, label: 'Close' }
    ]
  },
  {
    id: 'alert-wif-002',
    tokenSymbol: 'WIF',
    tokenName: 'dogwifhat',
    callerName: 'Crypto KD',
    callerHandle: '@crypto_kd',
    verdict: 'SUPER TRADE',
    rank: 4,
    winRate: 74,
    performancePercent: 41.3,
    mentionCount: 11,
    createdAt: new Date(Date.now() - 1000 * 60 * 32).toISOString(),
    summary: 'Multiple high-reputation accounts converged with rising short-window performance.',
    posts: [
      {
        id: 'post-3',
        handle: '@crypto_kd',
        text: 'WIF has the cleanest momentum setup on my board.',
        postedAt: new Date(Date.now() - 1000 * 60 * 35).toISOString()
      }
    ],
    timex: [
      { label: 'T-45m', valuePercent: 3.1 },
      { label: 'T-30m', valuePercent: 11.2 },
      { label: 'T-15m', valuePercent: 23.7 },
      { label: 'Now', valuePercent: 31.4 }
    ],
    pricePoints: [
      { at: new Date(Date.now() - 1000 * 60 * 60).toISOString(), price: 1.9, changePercent: 0, label: 'Open' },
      { at: new Date(Date.now() - 1000 * 60 * 45).toISOString(), price: 2.08, changePercent: 9.5, label: 'T+1' },
      { at: new Date(Date.now() - 1000 * 60 * 20).toISOString(), price: 2.42, changePercent: 27.4, label: 'T+2' },
      { at: new Date(Date.now() - 1000 * 60 * 3).toISOString(), price: 2.5, changePercent: 31.6, label: 'Close' }
    ]
  },
  {
    id: 'alert-rug-003',
    tokenSymbol: 'RUG',
    tokenName: 'Rugcheck',
    callerName: 'Hardriver',
    callerHandle: '@hardriver',
    verdict: 'AVOID',
    rank: 87,
    winRate: 31,
    performancePercent: -12.9,
    mentionCount: 3,
    createdAt: new Date(Date.now() - 1000 * 60 * 48).toISOString(),
    summary: 'Low-quality caller cluster and negative short-window confirmation.',
    posts: [
      {
        id: 'post-4',
        handle: '@hardriver',
        text: 'RUG might bounce if it gets attention.',
        postedAt: new Date(Date.now() - 1000 * 60 * 55).toISOString()
      }
    ],
    timex: [
      { label: 'T-45m', valuePercent: 1.9 },
      { label: 'T-30m', valuePercent: -2.2 },
      { label: 'T-15m', valuePercent: -7.1 },
      { label: 'Now', valuePercent: -9.8 }
    ],
    pricePoints: [
      { at: new Date(Date.now() - 1000 * 60 * 60).toISOString(), price: 0.42, changePercent: 0, label: 'Open' },
      { at: new Date(Date.now() - 1000 * 60 * 39).toISOString(), price: 0.4, changePercent: -4.8, label: 'T+1' },
      { at: new Date(Date.now() - 1000 * 60 * 18).toISOString(), price: 0.38, changePercent: -9.5, label: 'T+2' },
      { at: new Date(Date.now() - 1000 * 60 * 4).toISOString(), price: 0.37, changePercent: -11.9, label: 'Close' }
    ]
  }
];
