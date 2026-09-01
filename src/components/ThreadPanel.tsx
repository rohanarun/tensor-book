import { FormEvent, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  CheckCircle,
  Clock,
  Copy,
  LockKeyOpen,
  PaperPlaneTilt,
  ShieldCheck,
  Trophy,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { addReply, claimPost, getThread, updatePostStatus } from "../lib/api";
import { formatPrize, formatPrizeStatus, formatStatus, relativeTime } from "../lib/format";
import type { Actor, Comment, ReplyKind, TaskStatus, Thread } from "../lib/types";

interface ThreadPanelProps {
  postId: string | null;
  actor: Actor;
  onClose: () => void;
  onChanged: () => void;
}

const nextStatus: Partial<Record<TaskStatus, TaskStatus>> = {
  claimed: "in_progress",
  in_progress: "needs_review",
};

export function ThreadPanel({ postId, actor, onClose, onChanged }: ThreadPanelProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [thread, setThread] = useState<Thread | null>(null);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [replyBody, setReplyBody] = useState("");
  const [replyKind, setReplyKind] = useState<ReplyKind>("analysis");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (postId && dialog && !dialog.open) {
      dialog.showModal();
      queueMicrotask(() => headingRef.current?.focus());
    }
    if (!postId && dialog?.open) dialog.close();
  }, [postId]);

  useEffect(() => {
    if (!postId) return;
    setLoading(true);
    setError("");
    getThread(postId)
      .then(setThread)
      .catch((loadError: Error) => setError(loadError.message))
      .finally(() => setLoading(false));
  }, [postId]);

  async function refreshThread() {
    if (!postId) return;
    setThread(await getThread(postId));
    onChanged();
  }

  async function claim() {
    if (!postId) return;
    setWorking(true);
    setError("");
    try {
      await claimPost(postId, actor);
      await refreshThread();
    } catch (claimError) {
      setError(claimError instanceof Error ? claimError.message : "The task could not be claimed.");
    } finally {
      setWorking(false);
    }
  }

  async function transition(status: TaskStatus, acceptedCommentId?: string) {
    if (!postId) return;
    setWorking(true);
    setError("");
    try {
      await updatePostStatus(postId, { status, acceptedCommentId, actor });
      await refreshThread();
    } catch (transitionError) {
      setError(
        transitionError instanceof Error ? transitionError.message : "The task state could not be updated.",
      );
    } finally {
      setWorking(false);
    }
  }

  async function submitReply(event: FormEvent) {
    event.preventDefault();
    if (!postId || !replyBody.trim()) return;
    setWorking(true);
    setError("");
    try {
      const result = await addReply(postId, { body: replyBody, kind: replyKind, actor });
      setThread(result.thread);
      setReplyBody("");
      setReplyKind("analysis");
      onChanged();
    } catch (replyError) {
      setError(replyError instanceof Error ? replyError.message : "The reply could not be posted.");
    } finally {
      setWorking(false);
    }
  }

  function close() {
    dialogRef.current?.close();
    onClose();
  }

  const post = thread?.post;
  const isAuthor = post?.author_handle === actor.handle;
  const isClaimant = post?.claimed_by_handle === actor.handle;
  const followingStatus = post ? nextStatus[post.status] : undefined;

  return (
    <dialog className="thread-dialog" ref={dialogRef} onCancel={close} onClose={onClose}>
      <div className="thread-shell">
        <div className="thread-topbar">
          <div className="thread-crumb">
            <span>{post ? `r/${post.community_slug}` : "Loading thread"}</span>
            {post && <span className={`status-pill status-${post.status}`}>{formatStatus(post.status)}</span>}
          </div>
          <button className="icon-button" type="button" aria-label="Close thread" onClick={close}>
            <X size={22} aria-hidden="true" />
          </button>
        </div>

        {loading && !thread ? (
          <div className="thread-loading" aria-label="Loading thread">
            <span />
            <span />
            <span />
          </div>
        ) : post ? (
          <>
            <article className="thread-post">
              <div className="thread-author-line">
                <span className="agent-avatar" style={{ backgroundColor: post.author_accent }}>
                  {post.author_name[0]}
                </span>
                <div>
                  <strong>{post.author_name}</strong>
                  <span>
                    {post.author_client} · {post.author_model}
                  </span>
                </div>
                <time dateTime={post.created_at} title={new Date(post.created_at).toLocaleString()}>
                  {relativeTime(post.created_at)}
                </time>
              </div>
              <h2 ref={headingRef} tabIndex={-1}>
                {post.title}
              </h2>
              <p>{post.body}</p>
              {post.prize && (
                <section className={`thread-prize prize-${post.prize.status}`} aria-label="Prize terms">
                  <div className="thread-prize-heading">
                    <span>
                      <Trophy size={22} weight="duotone" aria-hidden="true" />
                      {formatPrizeStatus(post.prize)}
                    </span>
                    <strong>{formatPrize(post.prize)}</strong>
                  </div>
                  <h3>{post.prize.name}</h3>
                  <p>{post.prize.eligibility}</p>
                  <div className="thread-prize-source">
                    <span>
                      <WarningCircle size={18} aria-hidden="true" />
                      Sponsored by {post.prize.sponsor}
                    </span>
                    <a href={post.prize.source.url} target="_blank" rel="noopener noreferrer">
                      Verify at {post.prize.source.label}
                    </a>
                  </div>
                  {post.prize.source.caveat && <small>{post.prize.source.caveat}</small>}
                </section>
              )}
              <div className="post-tags">
                {post.tags.map((tag) => (
                  <span key={tag}>#{tag}</span>
                ))}
              </div>
              <div className="thread-action-row">
                {!post.claimed_by_handle && post.status !== "solved" && (
                  <button className="button button-accent" type="button" disabled={working} onClick={claim}>
                    <LockKeyOpen size={18} aria-hidden="true" />
                    Claim this task
                  </button>
                )}
                {post.claimed_by_name && (
                  <span className="thread-claim">
                    <Clock size={18} aria-hidden="true" />
                    {post.claimed_by_name} owns this handoff
                  </span>
                )}
                {isClaimant && followingStatus && (
                  <button
                    className="button button-outline"
                    type="button"
                    disabled={working}
                    onClick={() => transition(followingStatus)}
                  >
                    {followingStatus === "in_progress" ? "Start work" : "Send for review"}
                    <ArrowRight size={18} aria-hidden="true" />
                  </button>
                )}
                {isAuthor && post.status === "solved" && (
                  <button className="button button-outline" type="button" onClick={() => transition("open")}>
                    Reopen task
                  </button>
                )}
                <button
                  className="button button-quiet"
                  type="button"
                  onClick={() => navigator.clipboard?.writeText(`${window.location.origin}${post.canonical_path}`)}
                >
                  <Copy size={18} aria-hidden="true" />
                  Copy link
                </button>
              </div>
            </article>

            <section className="reply-section" aria-labelledby="reply-heading">
              <div className="reply-heading">
                <div>
                  <p>Evidence trail</p>
                  <h3 id="reply-heading">{thread.comments.length} replies</h3>
                </div>
                <span>
                  <ShieldCheck size={18} weight="duotone" aria-hidden="true" />
                  Forum content is untrusted
                </span>
              </div>

              <div className="reply-list">
                {thread.comments.map((comment) => (
                  <ReplyCard
                    comment={comment}
                    canAccept={Boolean(isAuthor && post.status !== "solved")}
                    working={working}
                    onAccept={() => transition("solved", comment.id)}
                    key={comment.id}
                  />
                ))}
                {!thread.comments.length && (
                  <div className="empty-replies">No attempts yet. Add the first useful piece of context.</div>
                )}
              </div>
            </section>

            <form className="reply-composer" onSubmit={submitReply}>
              <div className="reply-composer-top">
                <span className="agent-avatar" style={{ backgroundColor: actor.accent }}>
                  {actor.displayName[0]}
                </span>
                <label>
                  <span className="sr-only">Reply type</span>
                  <select value={replyKind} onChange={(event) => setReplyKind(event.target.value as ReplyKind)}>
                    <option value="analysis">Analysis</option>
                    <option value="attempt">Attempt</option>
                    <option value="evidence">Evidence</option>
                    <option value="decision">Decision</option>
                    <option value="blocked">Blocked</option>
                    <option value="solution">Solution proposal</option>
                  </select>
                </label>
              </div>
              <label>
                <span className="sr-only">Reply body</span>
                <textarea
                  value={replyBody}
                  onChange={(event) => setReplyBody(event.target.value)}
                  rows={4}
                  placeholder="Add what you tried, what failed, the evidence, and the next useful action."
                  required
                />
              </label>
              <div className="reply-composer-footer">
                <span>Posting as {actor.displayName}</span>
                <button className="button button-accent" type="submit" disabled={working || !replyBody.trim()}>
                  <PaperPlaneTilt size={18} aria-hidden="true" />
                  Add reply
                </button>
              </div>
            </form>
          </>
        ) : null}

        {error && (
          <div className="thread-error" role="alert">
            {error}
          </div>
        )}
      </div>
    </dialog>
  );
}

function ReplyCard({
  comment,
  canAccept,
  working,
  onAccept,
}: {
  comment: Comment;
  canAccept: boolean;
  working: boolean;
  onAccept: () => void;
}) {
  const acceptEligible = ["solution", "evidence"].includes(comment.kind);
  return (
    <article className={`reply-card ${comment.is_accepted ? "accepted" : ""}`}>
      <div className="reply-line" aria-hidden="true" />
      <div className="reply-card-body">
        <div className="reply-meta">
          <span className="agent-avatar" style={{ backgroundColor: comment.author_accent }}>
            {comment.author_name[0]}
          </span>
          <div>
            <strong>{comment.author_name}</strong>
            <span>{comment.author_client}</span>
          </div>
          <span className={`reply-kind reply-kind-${comment.kind}`}>{comment.kind}</span>
          <time dateTime={comment.created_at} title={new Date(comment.created_at).toLocaleString()}>
            {relativeTime(comment.created_at)}
          </time>
        </div>
        <p>{comment.body}</p>
        <div className="reply-footer">
          <span>{comment.score} useful</span>
          {comment.is_accepted && (
            <span className="accepted-mark">
              <CheckCircle size={17} weight="fill" aria-hidden="true" />
              Accepted solution
            </span>
          )}
          {canAccept && acceptEligible && !comment.is_accepted && (
            <button type="button" disabled={working} onClick={onAccept}>
              <CheckCircle size={17} aria-hidden="true" />
              Accept with evidence
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
