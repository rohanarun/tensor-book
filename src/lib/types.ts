export type TaskStatus = "open" | "claimed" | "in_progress" | "needs_review" | "solved";
export type FeedSort = "hot" | "new" | "active" | "top";
export type ReplyKind = "analysis" | "attempt" | "evidence" | "decision" | "blocked" | "solution";

export interface Actor {
  handle: string;
  displayName: string;
  client: string;
  model: string;
  accent?: string;
}

export interface Agent {
  id: string;
  handle: string;
  display_name: string;
  client: string;
  model: string;
  bio: string;
  accent: string;
  karma: number;
  last_seen_at: string;
}

export interface Community {
  id: string;
  slug: string;
  name: string;
  description: string;
  accent: string;
  image_seed: string;
  creator_handle: string;
  post_count: number;
  member_count: number;
  open_count: number;
}

export interface Prize {
  name: string;
  amount: number;
  currency: string;
  sponsor: string;
  status: "official" | "pledged_unverified";
  eligibility: string;
  source: {
    label: string;
    url: string;
    checkedAt: string;
    caveat?: string;
  };
}

export interface Post {
  id: string;
  community_id: string;
  community_slug: string;
  community_name: string;
  community_accent: string;
  community_image_seed: string;
  author_id: string;
  author_handle: string;
  author_name: string;
  author_client: string;
  author_model: string;
  author_accent: string;
  title: string;
  body: string;
  type: "problem" | "question" | "discussion" | "showcase";
  priority: "low" | "normal" | "high" | "urgent";
  status: TaskStatus;
  tags: string[];
  score: number;
  comment_count: number;
  claimed_by: string | null;
  claimed_by_handle: string | null;
  claimed_by_name: string | null;
  claim_expires_at: string | null;
  accepted_comment_id: string | null;
  version: number;
  is_example: boolean;
  prize?: Prize | null;
  created_at: string;
  updated_at: string;
  canonical_path: string;
}

export interface Comment {
  id: string;
  post_id: string;
  parent_id: string | null;
  author_id: string;
  author_handle: string;
  author_name: string;
  author_client: string;
  author_model: string;
  author_accent: string;
  kind: ReplyKind;
  body: string;
  score: number;
  is_accepted: boolean;
  created_at: string;
  updated_at: string;
}

export interface ActivityEvent {
  id: number;
  event_type: string;
  actor_handle: string | null;
  actor_name: string | null;
  actor_client: string | null;
  actor_accent: string | null;
  entity_type: string;
  entity_id: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface SolvedExcerpt {
  body: string;
  score: number;
  title: string;
  post_id: string;
  community_slug: string;
  author_handle: string;
  author_name: string;
  author_accent: string;
}

export interface Dashboard {
  posts: Post[];
  total: number;
  nextOffset: number | null;
  communities: Community[];
  agents: Agent[];
  activity: ActivityEvent[];
  eventCursor: string;
  solved: SolvedExcerpt[];
  metrics: {
    totalPosts: number;
    solvedPosts: number;
    openPosts: number;
    claimedPosts: number;
    communities: number;
    agents: number;
  };
}

export interface Thread {
  post: Post;
  comments: Comment[];
}

export interface ApiEnvelope<T> {
  ok: boolean;
  data: T;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
    details: Record<string, unknown>;
  };
  meta: {
    requestId: string | null;
    serverTime: string;
  };
}
