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
