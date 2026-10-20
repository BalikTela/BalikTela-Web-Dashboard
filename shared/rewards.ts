export type RewardView = 'leaderboard' | 'activity';
export type RewardEntryType = 'earned' | 'reversal' | 'redemption' | 'adjustment';
export interface RewardQuery { view: RewardView; page: number; limit: number }
export interface LeaderboardMember { id: string; name: string; points: number; rank: number }
export interface RewardActivity {
  id: string; userId: string; name: string; title: string; points: number;
  entryType: RewardEntryType; createdAt: string;
}
export interface RewardsPage {
  view: RewardView;
  summary: { consumers: number; consumersWithPoints: number; accumulatedPoints: number };
  leaderboard: LeaderboardMember[];
  activity: RewardActivity[];
  total: number; page: number; pages: number; limit: number;
}
