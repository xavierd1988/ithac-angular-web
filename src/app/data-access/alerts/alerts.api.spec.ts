import { coerceLiveAlertEvent } from './alerts.api';
import { AlertSignal } from './alerts.types';

describe('coerceLiveAlertEvent', () => {
  it('accepts an already mapped alert payload', () => {
    const alert: AlertSignal = {
      id: 'alert-1',
      tokenSymbol: 'PEPE',
      tokenName: 'Pepe',
      callerName: 'Caller',
      callerHandle: '@caller',
      verdict: 'GOOD TRADE',
      rank: 1,
      winRate: 70,
      performancePercent: 2.4,
      mentionCount: 3,
      createdAt: '2026-06-08T12:00:00.000Z',
      summary: 'Signal summary',
      posts: [],
      timex: [{ label: 'TIMEX completed', valuePercent: 2.4 }],
      pricePoints: []
    };

    expect(coerceLiveAlertEvent({ alert })).toEqual(alert);
  });

  it('maps backend alert events and normalizes numeric ids to strings', () => {
    const mapped = coerceLiveAlertEvent({
      alertId: 'external-alert',
      sourceAlertId: 84784,
      message: 'Pepe activity detected',
      timestamp: '2026-06-08T12:00:00.000Z',
      token: {
        symbol: 'PEPE',
        name: 'Pepe'
      },
      stats: {
        totalMentions: 2,
        totalInfluencers: 1
      },
      timex: {
        status: 'completed',
        resultPct: 1.5,
        pricePoints: [
          { t: '2026-06-08T11:00:00.000Z', price: 100 },
          { t: '2026-06-08T12:00:00.000Z', price: 101.5 }
        ]
      },
      rankedInfluencers: [
        {
          username: 'DyorNetCrypto',
          leaderboardRank: 1,
          callAnalysis: {
            winRate: 72
          }
        }
      ],
      consolidatedMentions: [
        {
          id: 123,
          influencer: 'DyorNetCrypto',
          mentionedAt: '2026-06-08T11:55:00.000Z'
        }
      ]
    });

    expect(mapped?.id).toBe('84784');
    expect(mapped?.sourceAlertId).toBe('84784');
    expect(mapped?.callerHandle).toBe('@DyorNetCrypto');
    expect(mapped?.performancePercent).toBe(1.5);
    expect(mapped?.posts[0]?.id).toBe('123');
    expect(mapped?.pricePoints.length).toBe(2);
    expect(mapped?.pricePoints[1]?.changePercent).toBe(1.5);
  });

  it('ignores unknown realtime payloads', () => {
    expect(coerceLiveAlertEvent({ type: 'heartbeat' })).toBeNull();
  });
});
