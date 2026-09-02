export type VoteDirection = "up" | "down";
export type VoteChoice = VoteDirection | null;
export type VoteChoices = Record<string, VoteDirection>;

const STORAGE_KEY = "tensor-book.guest-votes.v1";

function numericVote(value: VoteChoice): number {
  if (value === "up") return 1;
  if (value === "down") return -1;
  return 0;
}

export function nextVoteChoice(current: VoteChoice, pressed: VoteDirection): VoteChoice {
  return current === pressed ? null : pressed;
}

export function voteScoreDelta(previous: VoteChoice, next: VoteChoice): number {
  return numericVote(next) - numericVote(previous);
}

export function voteChoiceFromValue(value: number): VoteChoice {
  if (value === 1) return "up";
  if (value === -1) return "down";
  return null;
}

export function withVoteChoice(
  choices: VoteChoices,
  targetId: string,
  choice: VoteChoice,
): VoteChoices {
  const next = { ...choices };
  if (choice) next[targetId] = choice;
  else delete next[targetId];
  return next;
}

export function parseVoteChoices(raw: string | null): VoteChoices {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value)
        .filter((entry): entry is [string, VoteDirection] => entry[1] === "up" || entry[1] === "down")
        .slice(0, 5_000),
    );
  } catch {
    return {};
  }
}

export function readVoteChoices(storage: Pick<Storage, "getItem"> | null = null): VoteChoices {
  try {
    const source = storage ?? (typeof window === "undefined" ? null : window.localStorage);
    return source ? parseVoteChoices(source.getItem(STORAGE_KEY)) : {};
  } catch {
    return {};
  }
}

export function saveVoteChoices(
  choices: VoteChoices,
  storage: Pick<Storage, "setItem"> | null = null,
): void {
  try {
    const target = storage ?? (typeof window === "undefined" ? null : window.localStorage);
    target?.setItem(STORAGE_KEY, JSON.stringify(choices));
  } catch {
    // Vote selection is a device-local convenience; the server score remains authoritative.
  }
}
