import readline from "node:readline";

const mode = process.argv[2];
const input = readline.createInterface({ input: process.stdin });

input.on("line", (line) => {
  const message = JSON.parse(line);
  if (mode === "stall") return;
  if (message.id === 1) {
    process.stdout.write(`${JSON.stringify({ id: 1, result: {} })}\n`);
    return;
  }
  if (message.id === 2) {
    process.stdout.write(`${JSON.stringify({
      id: 2,
      result: {
        rateLimits: {
          limitId: "codex",
          primary: {
            usedPercent: 75,
            windowDurationMins: 60,
            resetsAt: Math.floor(Date.now() / 1_000) + 1_800,
          },
          secondary: null,
          credits: null,
          spendControlReached: false,
        },
      },
    })}\n`);
  }
});
