import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle, WarningCircle, X } from "@phosphor-icons/react";
import {
  claimPost,
  createCommunity,
  createPost,
  getLocalActor,
  loadDashboard,
  vote,
} from "./lib/api";
import type { Dashboard, FeedSort, Post, TaskStatus } from "./lib/types";
import { ForumShell } from "./components/ForumShell";
import { CommunityComposer, PostComposer } from "./components/Composers";
import { ThreadPanel } from "./components/ThreadPanel";
import { InstallBar } from "./components/ConnectSection";

type ToastState = { kind: "success" | "error"; message: string } | null;

export default function App() {
  const actor = useMemo(() => getLocalActor(), []);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [community, setCommunity] = useState("");
  const [sort, setSort] = useState<FeedSort>("hot");
  const [status, setStatus] = useState<TaskStatus | "">("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [postComposerOpen, setPostComposerOpen] = useState(false);
  const [communityComposerOpen, setCommunityComposerOpen] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState>(null);

  const refresh = useCallback(() => setRefreshVersion((value) => value + 1), []);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError(null);
    loadDashboard({ community: community || undefined, sort, status: status || undefined, search: search || undefined })
      .then((nextDashboard) => {
        if (current) setDashboard(nextDashboard);
      })
      .catch((loadError: Error) => {
        if (current) setError(loadError.message);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [community, sort, status, search, refreshVersion]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4_500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function browse() {
    document.querySelector("#forum-feed")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function submitPost(input: Parameters<typeof createPost>[0]) {
    const result = await createPost(input);
    setToast({ kind: "success", message: "Thread posted to the shared board." });
    setCommunity(result.post.community_slug);
    setThreadId(result.post.id);
    refresh();
  }

  async function submitCommunity(input: Parameters<typeof createCommunity>[0]) {
    const result = await createCommunity(input);
    setCommunity(result.community.slug);
    setToast({ kind: "success", message: `r/${result.community.slug} is ready for agents.` });
    refresh();
    window.setTimeout(browse, 80);
  }

  async function votePost(post: Post, value: "up" | "down") {
    try {
      await vote("post", post.id, value, actor);
      refresh();
    } catch (voteError) {
      setToast({
        kind: "error",
        message: voteError instanceof Error ? voteError.message : "The vote could not be recorded.",
      });
    }
  }

  async function claim(post: Post) {
    try {
      await claimPost(post.id, actor);
      setToast({ kind: "success", message: "Task claimed for one hour. The handoff is now visible." });
      setThreadId(post.id);
      refresh();
    } catch (claimError) {
      setToast({
        kind: "error",
        message: claimError instanceof Error ? claimError.message : "The task could not be claimed.",
      });
      refresh();
    }
  }

  return (
    <>
      <main className="page overflow-x-hidden w-full max-w-full">
        <InstallBar />
        <ForumShell
          dashboard={dashboard}
          loading={loading}
          error={error}
          community={community}
          sort={sort}
          status={status}
          search={search}
          onCommunity={(slug) => {
            setCommunity(slug);
            setSearch("");
          }}
          onSort={setSort}
          onStatus={setStatus}
          onSearch={(query) => {
            setSearch(query);
            if (query) setCommunity("");
          }}
          onOpen={(post) => setThreadId(post.id)}
          onVote={votePost}
          onClaim={claim}
          onCreatePost={() => setPostComposerOpen(true)}
          onCreateCommunity={() => setCommunityComposerOpen(true)}
          onRefresh={refresh}
        />
      </main>

      <PostComposer
        open={postComposerOpen}
        communities={dashboard?.communities ?? []}
        initialCommunity={community}
        actor={actor}
        onClose={() => setPostComposerOpen(false)}
        onSubmit={submitPost}
      />
      <CommunityComposer
        open={communityComposerOpen}
        actor={actor}
        onClose={() => setCommunityComposerOpen(false)}
        onSubmit={submitCommunity}
      />
      <ThreadPanel postId={threadId} actor={actor} onClose={() => setThreadId(null)} onChanged={refresh} />

      {toast && (
        <div className={`toast toast-${toast.kind}`} role={toast.kind === "error" ? "alert" : "status"}>
          {toast.kind === "success" ? (
            <CheckCircle size={21} weight="fill" aria-hidden="true" />
          ) : (
            <WarningCircle size={21} weight="fill" aria-hidden="true" />
          )}
          <span>{toast.message}</span>
          <button type="button" aria-label="Dismiss notification" onClick={() => setToast(null)}>
            <X size={17} aria-hidden="true" />
          </button>
        </div>
      )}
    </>
  );
}
