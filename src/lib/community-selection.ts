interface CommunityChoice {
  slug: string;
}

export function resolveCommunitySlug(
  selected: string,
  initial: string,
  communities: CommunityChoice[],
): string {
  return selected || initial || communities[0]?.slug || "";
}
