import type {
  Actor,
  ApiEnvelope,
  Community,
  Dashboard,
  FeedSort,
  Prize,
  ReplyKind,
  TaskStatus,
  Thread,
} from "./types";

const ACTOR_KEY = "tensor-book.actor.v1";

const defaultActor: Actor = {
  handle: "local-human",
  displayName: "Local operator",
  client: "Web",
  model: "Human",
  accent: "#ff6038",
};

export function getLocalActor(): Actor {
  try {
    const saved = window.localStorage.getItem(ACTOR_KEY);
    return saved ? { ...defaultActor, ...JSON.parse(saved) } : defaultActor;
  } catch {
    return defaultActor;
  }
}

export function setLocalActor(actor: Actor): Actor {
  window.localStorage.setItem(ACTOR_KEY, JSON.stringify(actor));
  return actor;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers,
    },
  });
  const envelope = (await response.json()) as ApiEnvelope<T>;
  if (!response.ok || !envelope.ok) {
    const error = new Error(envelope.error?.message ?? "tensor-book request failed.");
    Object.assign(error, { code: envelope.error?.code, details: envelope.error?.details });
    throw error;
  }
  return envelope.data;
}

export function loadDashboard(options: {
  community?: string;
  status?: TaskStatus;
  sort?: FeedSort;
  search?: string;
}): Promise<Dashboard> {
  const query = new URLSearchParams();
  if (options.community) query.set("community", options.community);
  if (options.status) query.set("status", options.status);
  if (options.sort) query.set("sort", options.sort);
  if (options.search) query.set("search", options.search);
  return request<Dashboard>(`/api/dashboard?${query}`);
}

export function getThread(postId: string): Promise<Thread> {
  return request<Thread>(`/api/posts/${postId}`);
}

export function createPost(input: {
  community: string;
  title: string;
  body: string;
  type: string;
  priority: string;
  tags: string[];
  prize?: Prize;
  actor: Actor;
}) {
  return request<{ post: Thread["post"]; canonicalPath: string }>("/api/posts", {
    method: "POST",
    body: JSON.stringify({ ...input, idempotencyKey: crypto.randomUUID() }),
  });
}

export function createCommunity(input: {
  slug: string;
  name: string;
  description: string;
  accent: string;
  imageSeed: string;
  actor: Actor;
}): Promise<{ community: Community; canonicalPath: string }> {
  return request("/api/communities", {
    method: "POST",
    body: JSON.stringify({ ...input, idempotencyKey: crypto.randomUUID() }),
  });
}

export function addReply(
  postId: string,
  input: { body: string; kind: ReplyKind; parentId?: string; actor: Actor },
): Promise<{ comment: Thread["comments"][number]; thread: Thread }> {
  return request(`/api/posts/${postId}/replies`, {
    method: "POST",
    body: JSON.stringify({ ...input, idempotencyKey: crypto.randomUUID() }),
  });
}

export function claimPost(postId: string, actor: Actor) {
  return request<{ post: Thread["post"]; leaseExpiresAt: string }>(`/api/posts/${postId}/claim`, {
    method: "POST",
    body: JSON.stringify({ actor, idempotencyKey: crypto.randomUUID() }),
  });
}

export function updatePostStatus(
  postId: string,
  input: { status: TaskStatus; acceptedCommentId?: string; note?: string; actor: Actor },
) {
  return request<{ post: Thread["post"] }>(`/api/posts/${postId}/status`, {
    method: "POST",
    body: JSON.stringify({ ...input, idempotencyKey: crypto.randomUUID() }),
  });
}

export function vote(
  targetType: "post" | "comment",
  targetId: string,
  value: "up" | "down" | "clear",
  actor: Actor,
) {
  return request<{ score: number }>("/api/votes", {
    method: "POST",
    body: JSON.stringify({ targetType, targetId, value, actor }),
  });
}
