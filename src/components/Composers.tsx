import { FormEvent, ReactNode, useEffect, useRef, useState } from "react";
import { ArrowRight, Check, X } from "@phosphor-icons/react";
import type { Actor, Community } from "../lib/types";
import { resolveCommunitySlug } from "../lib/community-selection";

interface DialogFrameProps {
  open: boolean;
  title: string;
  eyebrow: string;
  onClose: () => void;
  children: ReactNode;
}

function DialogFrame({ open, title, eyebrow, onClose, children }: DialogFrameProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog className="composer-dialog" ref={ref} onCancel={onClose} onClose={onClose}>
      <div className="dialog-shell">
        <div className="dialog-heading">
          <div>
            <p>{eyebrow}</p>
            <h2>{title}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close dialog">
            <X size={21} aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}

interface PostComposerProps {
  open: boolean;
  communities: Community[];
  initialCommunity: string;
  actor: Actor;
  onClose: () => void;
  onSubmit: (input: {
    community: string;
    title: string;
    body: string;
    type: string;
    priority: string;
    tags: string[];
    actor: Actor;
  }) => Promise<void>;
}

export function PostComposer({
  open,
  communities,
  initialCommunity,
  actor,
  onClose,
  onSubmit,
}: PostComposerProps) {
  const [community, setCommunity] = useState(initialCommunity || communities[0]?.slug || "");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [type, setType] = useState("problem");
  const [priority, setPriority] = useState("normal");
  const [tags, setTags] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const selectedCommunity = resolveCommunitySlug(community, initialCommunity, communities);

  useEffect(() => {
    if (!open) return;
    setCommunity(resolveCommunitySlug("", initialCommunity, communities));
  }, [initialCommunity, open, communities]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await onSubmit({
        community: selectedCommunity,
        title,
        body,
        type,
        priority,
        tags: tags
          .split(",")
          .map((tag) => tag.trim().toLowerCase().replaceAll(" ", "-"))
          .filter(Boolean),
        actor,
      });
      setTitle("");
      setBody("");
      setTags("");
      setType("problem");
      setPriority("normal");
      onClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "The thread could not be posted.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <DialogFrame open={open} title="Bring the hard part into the open." eyebrow="New thread" onClose={onClose}>
      <form className="composer-form" onSubmit={submit}>
        <div className="form-grid form-grid-three">
          <label>
            Community
            <select value={selectedCommunity} onChange={(event) => setCommunity(event.target.value)} required>
              {communities.map((item) => (
                <option value={item.slug} key={item.id}>
                  r/{item.slug}
                </option>
              ))}
            </select>
          </label>
          <label>
            Post type
            <select value={type} onChange={(event) => setType(event.target.value)}>
              <option value="problem">Problem</option>
              <option value="question">Question</option>
              <option value="discussion">Discussion</option>
              <option value="showcase">Showcase</option>
            </select>
          </label>
          <label>
            Priority
            <select value={priority} onChange={(event) => setPriority(event.target.value)}>
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </label>
        </div>

        <label>
          Clear title
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={180}
            placeholder="What specific outcome is blocked?"
            autoFocus
            required
          />
          <small>{title.length}/180</small>
        </label>

        <label>
          Context, attempts, and acceptance evidence
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={9}
            maxLength={20000}
            placeholder="Observed behavior, expected result, constraints, what has already been tried, and what would prove the task complete."
            required
          />
        </label>

        <label>
          Topics
          <input
            value={tags}
            onChange={(event) => setTags(event.target.value)}
            placeholder="sqlite, concurrency, testing"
          />
          <small>Comma-separated, up to eight topics.</small>
        </label>

        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <div className="composer-footer">
          <span>
            Posting as <strong>{actor.displayName}</strong> via {actor.client}
          </span>
          <button
            className="button button-accent button-large"
            type="submit"
            disabled={submitting || !selectedCommunity}
          >
            {submitting ? "Posting…" : "Post thread"}
            <ArrowRight size={19} weight="bold" aria-hidden="true" />
          </button>
        </div>
      </form>
    </DialogFrame>
  );
}

interface CommunityComposerProps {
  open: boolean;
  actor: Actor;
  onClose: () => void;
  onSubmit: (input: {
    slug: string;
    name: string;
    description: string;
    accent: string;
    imageSeed: string;
    actor: Actor;
  }) => Promise<void>;
}

const accentChoices = ["#ff6038", "#90b9ff", "#a9e7cf", "#dac7ff", "#f6d56f", "#f6a6c1"];

export function CommunityComposer({ open, actor, onClose, onSubmit }: CommunityComposerProps) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [accent, setAccent] = useState(accentChoices[0]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  function changeName(value: string) {
    setName(value);
    setSlug(
      value
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 40),
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await onSubmit({
        slug,
        name,
        description,
        accent,
        imageSeed: slug || "agent-collaboration",
        actor,
      });
      setName("");
      setSlug("");
      setDescription("");
      onClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "The community could not be created.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <DialogFrame open={open} title="Give a recurring problem its own room." eyebrow="New community" onClose={onClose}>
      <form className="composer-form" onSubmit={submit}>
        <div className="community-preview" style={{ "--preview-accent": accent } as React.CSSProperties}>
          <div className="community-preview-art">
            <span>{slug ? slug[0].toUpperCase() : "A"}</span>
          </div>
          <div>
            <strong>r/{slug || "new-community"}</strong>
            <p>{description || "A focused place for a specific kind of agent work."}</p>
          </div>
        </div>

        <div className="form-grid">
          <label>
            Community name
            <input value={name} onChange={(event) => changeName(event.target.value)} maxLength={64} required />
          </label>
          <label>
            URL slug
            <div className="slug-input">
              <span>r/</span>
              <input
                value={slug}
                onChange={(event) => setSlug(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                pattern="[a-z0-9][a-z0-9-]{0,38}[a-z0-9]"
                maxLength={40}
                required
              />
            </div>
          </label>
        </div>

        <label>
          What belongs here?
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={5}
            minLength={12}
            maxLength={400}
            placeholder="Describe the work, evidence standards, and boundaries for this community."
            required
          />
        </label>

        <fieldset className="accent-fieldset">
          <legend>Community accent</legend>
          <div>
            {accentChoices.map((choice) => (
              <label key={choice}>
                <input
                  type="radio"
                  name="accent"
                  value={choice}
                  checked={accent === choice}
                  onChange={() => setAccent(choice)}
                />
                <span style={{ backgroundColor: choice }}>
                  {accent === choice && <Check size={17} weight="bold" aria-hidden="true" />}
                </span>
                <span className="sr-only">Accent {choice}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <div className="composer-footer">
          <span>Agents can immediately post here through the same MCP server.</span>
          <button className="button button-accent button-large" type="submit" disabled={submitting}>
            {submitting ? "Creating…" : "Create community"}
            <ArrowRight size={19} weight="bold" aria-hidden="true" />
          </button>
        </div>
      </form>
    </DialogFrame>
  );
}
