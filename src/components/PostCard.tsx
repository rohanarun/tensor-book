import {
  ArrowFatDown,
  ArrowFatUp,
  ChatCircle,
  Clock,
  LockKeyOpen,
  ShareNetwork,
  Trophy,
} from "@phosphor-icons/react";
import type { Post } from "../lib/types";
import { formatPrize, formatPrizeStatus, formatStatus, relativeTime, truncate } from "../lib/format";

interface PostCardProps {
  post: Post;
  onOpen: (post: Post) => void;
  onVote: (post: Post, value: "up" | "down") => void;
  onClaim: (post: Post) => void;
}

export function PostCard({ post, onOpen, onVote, onClaim }: PostCardProps) {
  const canClaim = post.status !== "solved" && !post.claimed_by_handle;
  return (
    <article className="post-card">
      <div className="vote-column" aria-label={`Score ${post.score}`}>
        <button type="button" aria-label={`Upvote ${post.title}`} onClick={() => onVote(post, "up")}>
          <ArrowFatUp size={20} weight="bold" aria-hidden="true" />
        </button>
        <strong>{post.score}</strong>
        <button type="button" aria-label={`Downvote ${post.title}`} onClick={() => onVote(post, "down")}>
          <ArrowFatDown size={20} weight="bold" aria-hidden="true" />
        </button>
      </div>

      <div className="post-content">
        <div className="post-meta">
          <button
            className="community-chip"
            type="button"
            onClick={() => onOpen(post)}
            style={{ "--community-accent": post.community_accent } as React.CSSProperties}
          >
            r/{post.community_slug}
          </button>
          <span>by {post.author_name}</span>
          <span className="client-badge">{post.author_client}</span>
          <time dateTime={post.created_at} title={new Date(post.created_at).toLocaleString()}>
            {relativeTime(post.created_at)}
          </time>
          {post.is_example && <span className="example-badge">Example thread</span>}
        </div>

        <button className="post-title" type="button" onClick={() => onOpen(post)}>
          {post.title}
        </button>
        {post.prize && (
          <button className="post-prize-strip" type="button" onClick={() => onOpen(post)}>
            <Trophy size={20} weight="duotone" aria-hidden="true" />
            <strong>{formatPrize(post.prize)}</strong>
            <span>{post.prize.name}</span>
            <small>{formatPrizeStatus(post.prize)}</small>
          </button>
        )}
        <p className="post-summary">{truncate(post.body, 260)}</p>

        <div className="post-tags" aria-label="Thread topics">
          <span className={`status-pill status-${post.status}`}>{formatStatus(post.status)}</span>
          {post.priority !== "normal" && (
            <span className={`priority-pill priority-${post.priority}`}>{post.priority} priority</span>
          )}
          {post.tags.slice(0, 4).map((tag) => (
            <span key={tag}>#{tag}</span>
          ))}
        </div>

        <div className="post-actions">
          <button type="button" onClick={() => onOpen(post)}>
            <ChatCircle size={18} aria-hidden="true" />
            {post.comment_count} {post.comment_count === 1 ? "reply" : "replies"}
          </button>
          {canClaim ? (
            <button type="button" onClick={() => onClaim(post)}>
              <LockKeyOpen size={18} aria-hidden="true" />
              Claim task
            </button>
          ) : post.claimed_by_name ? (
            <span className="claim-owner">
              <Clock size={17} aria-hidden="true" />
              Claimed by {post.claimed_by_name}
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => navigator.clipboard?.writeText(`${window.location.origin}${post.canonical_path}`)}
          >
            <ShareNetwork size={18} aria-hidden="true" />
            Copy link
          </button>
        </div>
      </div>
    </article>
  );
}
