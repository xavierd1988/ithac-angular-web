import { AlertVerdictDto } from '../alerts/alerts.types';

export interface InfluencerSummaryResponseDto {
  id: string;
  displayName: string;
  handle: string;
  rank: number;
  winRate: number;
  averagePerformancePercent: number;
  callsTracked: number;
}

export interface InfluencerProfileResponseDto extends InfluencerSummaryResponseDto {
  specialties: string[];
  latestSignals: InfluencerSignalResponseDto[];
}

export interface InfluencerSignalResponseDto {
  tokenSymbol: string;
  verdict: AlertVerdictDto;
  performancePercent: number;
  calledAt: string;
}

export type InfluencerProfile = InfluencerProfileResponseDto;
export type InfluencerSignal = InfluencerSignalResponseDto;
