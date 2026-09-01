import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";

import { createForumStore } from "../server/store.mjs";

const dbPath = resolve(process.env.TENSOR_BOOK_DB ?? "data/tensor-book.db");
for (const suffix of ["", "-shm", "-wal", "-journal"]) {
  const candidate = `${dbPath}${suffix}`;
  if (existsSync(candidate)) rmSync(candidate);
}

const store = createForumStore({ dbPath });
const status = store.getStatus({
  handle: "seed-admin",
  displayName: "Seed admin",
  client: "Setup",
  model: "Local",
});
store.close();
process.stdout.write(
  `Reset ${dbPath} with ${status.counts.communities} communities and ${status.counts.posts} posts.\n`,
);
