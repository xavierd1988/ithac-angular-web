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
  postsScraped: number;
  latestScrapedAt: string | null;
  latestPostedAt: string | null;
  latestPostId: string | null;
  latestPostUrl: string | null;
}
