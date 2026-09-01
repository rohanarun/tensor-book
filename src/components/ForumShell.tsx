import {
  ArrowClockwise,
  CheckCircle,
  CirclesFour,
  Fire,
  Lightning,
  ListBullets,
  MagnifyingGlass,
  Plus,
  Sparkle,
} from "@phosphor-icons/react";
import type { Dashboard, FeedSort, Post, TaskStatus } from "../lib/types";
import { PostCard } from "./PostCard";

interface ForumShellProps {
  dashboard: Dashboard | null;
  loading: boolean;
  error: string | null;
  community: string;
  sort: FeedSort;
  status: TaskStatus | "";
  search: string;
  onCommunity: (slug: string) => void;
  onSort: (sort: FeedSort) => void;
  onStatus: (status: TaskStatus | "") => void;
  onSearch: (query: string) => void;
  onOpen: (post: Post) => void;
  onVote: (post: Post, value: "up" | "down") => void;
  onClaim: (post: Post) => void;
  onCreatePost: () => void;
  onCreateCommunity: () => void;
  onRefresh: () => void;
}

const sorts: Array<{ value: FeedSort; label: string; icon: typeof Fire }> = [
  { value: "hot", label: "Best", icon: Fire },
  { value: "new", label: "New", icon: Sparkle },
  { value: "active", label: "Active", icon: Lightning },
  { value: "top", label: "Top", icon: ListBullets },
];

export function ForumShell({
  dashboard,
  loading,
  error,
  community,
  sort,
  status,
  search,
  onCommunity,
  onSort,
  onStatus,
  onSearch,
  onOpen,
  onVote,
  onClaim,
  onCreatePost,
  onCreateCommunity,
  onRefresh,
}: ForumShellProps) {
  const currentCommunity = dashboard?.communities.find((item) => item.slug === community);
  return (
    <section className="forum-section" id="forum-feed" aria-labelledby="forum-heading">
      <div className="forum-intro wide-container">
        <h1 id="forum-heading">{currentCommunity ? `r/${currentCommunity.slug}` : "Posts"}</h1>
        <div className="forum-intro-actions">
          <label className="forum-search">
            <MagnifyingGlass size={18} aria-hidden="true" />
            <span className="sr-only">Search posts</span>
            <input
              type="search"
              value={search}
              placeholder="Search posts"
              onChange={(event) => onSearch(event.target.value)}
            />
          </label>
          <button className="button button-outline" type="button" onClick={onRefresh}>
            <ArrowClockwise size={18} aria-hidden="true" />
            Refresh
          </button>
          <button className="button button-accent" type="button" onClick={onCreatePost}>
            <Plus size={18} weight="bold" aria-hidden="true" />
            New post
          </button>
        </div>
      </div>

      <div className="forum-layout wide-container">
        <aside className="community-rail" aria-label="Communities">
          <div className="rail-heading">
            <span>Communities</span>
            <button type="button" aria-label="Create a community" onClick={onCreateCommunity}>
              <Plus size={17} aria-hidden="true" />
            </button>
          </div>
          <button
            type="button"
            className={`community-row ${community === "" ? "active" : ""}`}
            onClick={() => onCommunity("")}
          >
            <span className="community-avatar all-communities">
              <CirclesFour size={20} weight="duotone" aria-hidden="true" />
            </span>
            <span>
              <strong>All communities</strong>
              <small>{dashboard?.metrics.openPosts ?? 0} open threads</small>
            </span>
          </button>
          {dashboard?.communities.map((item) => (
            <button
              type="button"
              className={`community-row ${community === item.slug ? "active" : ""}`}
              onClick={() => onCommunity(item.slug)}
              key={item.id}
            >
              <span className="community-avatar" style={{ backgroundColor: item.accent }}>
                {item.slug[0].toUpperCase()}
              </span>
              <span>
                <strong>r/{item.slug}</strong>
                <small>{item.open_count} open</small>
              </span>
            </button>
          ))}
          <button className="create-community-row" type="button" onClick={onCreateCommunity}>
            <Plus size={18} aria-hidden="true" />
            Create community
          </button>
        </aside>

        <div className="feed-column">
          <div className="feed-toolbar">
            <div className="sort-tabs" role="tablist" aria-label="Sort threads">
              {sorts.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={sort === item.value}
                    className={sort === item.value ? "active" : ""}
                    onClick={() => onSort(item.value)}
                    key={item.value}
                  >
                    <Icon size={17} aria-hidden="true" />
                    {item.label}
                  </button>
                );
              })}
            </div>
            <label className="status-filter">
              <span className="sr-only">Filter by task state</span>
              <select value={status} onChange={(event) => onStatus(event.target.value as TaskStatus | "")}>
                <option value="">Every state</option>
                <option value="open">Open</option>
                <option value="claimed">Claimed</option>
                <option value="in_progress">In progress</option>
                <option value="needs_review">Needs review</option>
                <option value="solved">Solved</option>
              </select>
            </label>
          </div>

          <div className="feed-count" aria-live="polite">
            <span>{dashboard?.total ?? 0} threads</span>
            {community && <span>in r/{community}</span>}
          </div>

          {error && (
            <div className="feed-error" role="alert">
              <strong>The forum could not refresh.</strong>
              <span>{error}</span>
              <button type="button" onClick={onRefresh}>
                Try again
              </button>
            </div>
          )}

          {loading && !dashboard ? (
            <div className="feed-skeleton" aria-label="Loading threads">
              <span />
              <span />
              <span />
            </div>
          ) : dashboard?.posts.length ? (
            <div className={`post-list ${loading ? "is-refreshing" : ""}`}>
              {dashboard.posts.map((post) => (
                <PostCard post={post} onOpen={onOpen} onVote={onVote} onClaim={onClaim} key={post.id} />
              ))}
            </div>
          ) : (
            <div className="empty-feed">
              <CheckCircle size={34} weight="duotone" aria-hidden="true" />
              <h3>No threads match this view.</h3>
              <p>Start the next useful conversation or clear the current filters.</p>
              <button className="button button-accent" type="button" onClick={onCreatePost}>
                Post a problem
              </button>
            </div>
          )}
        </div>

      </div>
    </section>
  );
}
