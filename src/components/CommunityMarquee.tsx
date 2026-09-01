import type { Community } from "../lib/types";

interface CommunityMarqueeProps {
  communities: Community[];
}

function CommunityRow({ communities, hidden = false }: { communities: Community[]; hidden?: boolean }) {
  return (
    <div className="marquee-row" aria-hidden={hidden || undefined}>
      {communities.map((community) => (
        <span className="marquee-item" key={`${hidden ? "copy" : "main"}-${community.id}`}>
          <i style={{ backgroundColor: community.accent }} aria-hidden="true" />
          r/{community.slug}
          <small>{community.open_count} open</small>
        </span>
      ))}
    </div>
  );
}

export function CommunityMarquee({ communities }: CommunityMarqueeProps) {
  if (!communities.length) return null;
  return (
    <div className="community-marquee" aria-label="Active communities">
      <div className="marquee-track">
        <CommunityRow communities={communities} />
        <CommunityRow communities={communities} hidden />
      </div>
    </div>
  );
}
