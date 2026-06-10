export interface RawDbMention {
  id: string;
  postId: string;
  tokenSymbol: string;
  tokenName: string;
  influencer: string;
  profileUrl: string;
  postUrl: string | null;
  text: string;
  mentionedAt: string;
}

export interface RawDbInfluencer {
  influencerId: string;
  username: string;
  name: string | null;
  profileImageUrl: string | null;
  profileUrl: string | null;
  followersCount: number;
  ithacIndex: number | null;
  communityRating: number | null;
  upvoteCount: number;
  downvoteCount: number;
  totalVotes: number;
  storedMentionCount: number;
  storedMatchCount: number;
  storedPostCount: number;
  rawMentionCount: number;
  rawPostCount: number;
  rawTokenCount: number;
  latestMentionAt: string | null;
  lastMentionAt: string | null;
  lastMatchAt: string | null;
  lastPostAt: string | null;
  lastActivityAt: string | null;
}

export interface RawDbInfluencersResponse {
  total: number;
  data: RawDbInfluencer[];
}

export interface RawDbScrapeHealth {
  checkedAt: string;
  dbNow: string | null;
  status: 'fresh' | 'stale' | 'unknown';
  latest: {
    latestScrapedAt: string | null;
    latestPostedAt: string | null;
    latestMentionAt: string | null;
    scrapeLagMinutes: number | null;
    mentionLagMinutes: number | null;
  };
  totals: {
    posts: number;
    mentions: number;
  };
  windows: {
    posts5m: number;
    posts15m: number;
    posts60m: number;
    posts24h: number;
    mentions5m: number;
    mentions15m: number;
    mentions60m: number;
    mentions24h: number;
  };
  buckets: RawDbScrapeBucket[];
  recentInfluencers: RawDbRecentScrapedInfluencer[];
  cycleCoverage: RawDbScrapeCycleCoverage;
  cycleBlocks: RawDbScrapeCycleBlock[];
  cycleUsers: RawDbScrapeCycleUser[];
}

export interface RawDbScrapeBucket {
  bucketStart: string | null;
  postsScraped: number;
  mentions: number;
}

export interface RawDbRecentScrapedInfluencer {
  influencerId: string;
  username: string;
  name: string | null;
  profileImageUrl: string | null;
  profileUrl: string | null;
  followersCount: number;
  followerRank: number;
  cyclePosition: number;
  postsScraped: number;
  latestScrapedAt: string | null;
  latestPostedAt: string | null;
  latestPostId: string | null;
  latestPostUrl: string | null;
}

export interface RawDbScrapeCycleCoverage {
  blockCount: number;
  completedBlockCount: number;
  averageCoveragePct: number;
  completedAverageCoveragePct: number;
  weightedCoveragePct: number;
  coveredAccounts: number;
  possibleAccounts: number;
}

export interface RawDbScrapeCycleBlock {
  blockId: string;
  colorIndex: number;
  status: 'current' | 'completed';
  isCurrent: boolean;
  startedAt: string | null;
  endedAt: string | null;
  completedAt: string | null;
  durationMinutes: number | null;
  minCyclePosition: number;
  maxCyclePosition: number;
  positionSpan: number;
  coveragePct: number;
  minUserId: string;
  maxUserId: string;
  influencerCount: number;
  postsScraped: number;
  entries: RawDbScrapeCycleEntry[];
  samples: RawDbScrapeCycleSample[];
}

export interface RawDbScrapeCycleSample {
  username: string;
  cyclePosition: number;
  followersCount: number;
  postsScraped: number;
  latestScrapedAt: string | null;
}

export interface RawDbScrapeCycleEntry {
  influencerId: string;
  username: string;
  cyclePosition: number;
  followersCount: number;
  postsScraped: number;
  latestScrapedAt: string | null;
}

export interface RawDbScrapeCycleUser {
  influencerId: string;
  username: string;
  name: string | null;
  profileImageUrl: string | null;
  profileUrl: string | null;
  followersCount: number;
  cyclePosition: number;
  isCurrent: boolean;
  isRecentlyScraped: boolean;
  postsScraped: number;
  latestScrapedAt: string | null;
  latestPostUrl: string | null;
}
