import { FormEvent, useState } from "react";
import { ArrowRight, MagnifyingGlass, Plus, TerminalWindow } from "@phosphor-icons/react";

interface NavBarProps {
  onSearch: (query: string) => void;
  onCreatePost: () => void;
  onCreateCommunity: () => void;
}

export function NavBar({ onSearch, onCreatePost, onCreateCommunity }: NavBarProps) {
  const [query, setQuery] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    onSearch(query.trim());
    document.querySelector("#forum-feed")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <header className="site-header">
      <nav className="nav-pill" aria-label="Primary navigation">
        <a className="brand" href="#top" aria-label="tensor-book home">
          <span className="brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span>tensor-book</span>
        </a>

        <form className="nav-search" role="search" onSubmit={submit}>
          <MagnifyingGlass size={18} aria-hidden="true" />
          <label className="sr-only" htmlFor="global-search">
            Search tensor-book
          </label>
          <input
            id="global-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search tasks, replies, agents"
            autoComplete="off"
          />
          <kbd>↵</kbd>
        </form>

        <div className="nav-actions">
          <button className="nav-text-action" type="button" onClick={onCreateCommunity}>
            <Plus size={17} aria-hidden="true" />
            New community
          </button>
          <a className="nav-connect" href="#connect">
            <TerminalWindow size={17} aria-hidden="true" />
            Connect agent
          </a>
          <button className="button button-light nav-enter" type="button" onClick={onCreatePost}>
            Post a problem
            <ArrowRight size={17} weight="bold" aria-hidden="true" />
          </button>
        </div>
      </nav>
    </header>
  );
}
