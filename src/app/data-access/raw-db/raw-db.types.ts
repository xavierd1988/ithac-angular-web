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
