export type AlertVerdictDto = 'GOOD TRADE' | 'AVOID' | 'SUPER TRADE';

export interface AlertSummaryResponseDto {
  id: string;
  sourceAlertId?: string;
  externalAlertId?: string;
  tokenSymbol: string;
  tokenName: string;
  callerName: string;
  callerHandle: string;
  verdict: AlertVerdictDto;
  rank: number;
  winRate: number;
  performancePercent: number;
  mentionCount: number;
  createdAt: string;
  summary: string;
}

export interface AlertDetailResponseDto extends AlertSummaryResponseDto {
  posts: AlertPostResponseDto[];
  timex: TimexPointResponseDto[];
  pricePoints: TimexPricePointResponseDto[];
}

export interface AlertPostResponseDto {
  id: string;
  handle: string;
  text: string;
  postedAt: string;
  sourceUrl?: string;
}

export interface TimexPointResponseDto {
  label: string;
  valuePercent: number;
}

export interface TimexPricePointResponseDto {
  at: string;
  price: number;
  changePercent: number;
  label: string;
}

export interface CryptoMentionAlertEventDto {
  alert: AlertDetailResponseDto;
  receivedAt: string;
  source: 'signalr';
}

export type AlertVerdict = AlertVerdictDto;
export type AlertSignal = AlertDetailResponseDto;
export type AlertPost = AlertPostResponseDto;
export type TimexPoint = TimexPointResponseDto;
export type TimexPricePoint = TimexPricePointResponseDto;
