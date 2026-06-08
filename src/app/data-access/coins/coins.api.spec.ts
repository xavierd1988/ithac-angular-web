import { AlertSignal } from '../alerts/alerts.types';
import { buildCoinSignalSummaries } from './coins.api';

describe('buildCoinSignalSummaries', () => {
  it('groups alerts by token and ranks the most active coins first', () => {
    const alerts: AlertSignal[] = [
      alert({ id: 'btc-1', tokenSymbol: 'BTC', performancePercent: 5, mentionCount: 3 }),
      alert({ id: 'eth-1', tokenSymbol: 'ETH', performancePercent: 20, mentionCount: 4 }),
      alert({ id: 'btc-2', tokenSymbol: 'BTC', performancePercent: -1, mentionCount: 2 })
    ];

    const summaries = buildCoinSignalSummaries(alerts);

    expect(summaries.length).toBe(2);
    expect(summaries[0].symbol).toBe('BTC');
    expect(summaries[0].alertCount).toBe(2);
    expect(summaries[0].mentionCount).toBe(5);
    expect(summaries[0].averagePerformancePercent).toBe(2);
    expect(summaries[1].symbol).toBe('ETH');
  });

  it('projects the latest TIMEX points into sparkline heights', () => {
    const summaries = buildCoinSignalSummaries([
      alert({
        id: 'sol-1',
        tokenSymbol: 'SOL',
        performancePercent: 8,
        pricePoints: [
          { at: '2026-06-08T10:00:00.000Z', price: 100, changePercent: 0, label: 'Open' },
          { at: '2026-06-08T11:00:00.000Z', price: 108, changePercent: 8, label: 'Close' }
        ]
      })
    ]);

    expect(summaries[0].sparkline.length).toBe(2);
    expect(summaries[0].sparkline[0].heightPercent).toBe(18);
    expect(summaries[0].sparkline[1].heightPercent).toBe(100);
  });
});

function alert(overrides: Partial<AlertSignal>): AlertSignal {
  const tokenSymbol = overrides.tokenSymbol ?? 'BTC';

  return {
    id: 'alert-1',
    tokenSymbol,
    tokenName: tokenSymbol,
    callerName: 'Caller',
    callerHandle: '@caller',
    verdict: 'GOOD TRADE',
    rank: 1,
    winRate: 70,
    performancePercent: 1,
    mentionCount: 1,
    createdAt: '2026-06-08T12:00:00.000Z',
    summary: 'Signal summary',
    posts: [],
    timex: [{ label: 'TIMEX completed', valuePercent: 1 }],
    pricePoints: [{ at: '2026-06-08T12:00:00.000Z', price: 1, changePercent: 0, label: 'Open' }],
    ...overrides
  };
}
