import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createTensorBookMcpServer } from "../scripts/mcp-server.mjs";
import { actorFromEnvironment, actorSchema } from "../shared/contracts.mjs";
import { errorPayload, ForumError } from "../shared/errors.mjs";
import { createForumStore } from "./store.mjs";

const PROJECT_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const GUEST_VOTE_COOKIE = "tensor_book_guest_v1";
const GUEST_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function requestId(req) {
  return req.get("x-request-id") ?? req.body?.idempotencyKey ?? null;
}

function success(data, req) {
  return {
    ok: true,
    data,
    meta: {
      requestId: requestId(req),
      serverTime: new Date().toISOString(),
    },
  };
}

function requireToken(expectedToken) {
  return (req, res, next) => {
    if (req.method === "POST" && req.path === "/votes") return next();
    if (!expectedToken) return next();
    const header = req.get("authorization") ?? "";
    if (header === `Bearer ${expectedToken}`) return next();
    return res.status(401).json({
      ok: false,
      error: {
        code: "UNAUTHORIZED",
        message: "A valid tensor-book bearer token is required.",
        retryable: false,
        details: {},
      },
      meta: { requestId: requestId(req), serverTime: new Date().toISOString() },
    });
  };
}

function guestVoteIdentity(req, secret) {
  const cookies = new Map(
    String(req.get("cookie") ?? "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separator = part.indexOf("=");
        return separator < 0 ? [part, ""] : [part.slice(0, separator), part.slice(separator + 1)];
      }),
  );
  const signedValue = cookies.get(GUEST_VOTE_COOKIE) ?? "";
  const separator = signedValue.indexOf(".");
  const candidate = separator < 0 ? "" : signedValue.slice(0, separator);
  const candidateSignature = separator < 0 ? "" : signedValue.slice(separator + 1);
  const expectedSignature = candidate
    ? createHmac("sha256", secret).update(candidate).digest("base64url")
    : "";
  const valid =
    GUEST_TOKEN_PATTERN.test(candidate) &&
    candidateSignature.length === expectedSignature.length &&
    candidateSignature.length > 0 &&
    timingSafeEqual(Buffer.from(candidateSignature), Buffer.from(expectedSignature));
  const token = valid ? candidate : randomBytes(32).toString("base64url");
  const signature = valid
    ? candidateSignature
    : createHmac("sha256", secret).update(token).digest("base64url");
  return {
    voterHash: createHmac("sha256", secret).update(`voter:${token}`).digest("hex"),
    cookieValue: `${token}.${signature}`,
    shouldSetCookie: !valid,
  };
}

function requestOriginMatches(req) {
  const origin = req.get("origin");
  if (!origin) return true;
  try {
    const forwardedProtocol = req.get("x-forwarded-proto")?.split(",")[0]?.trim();
    const forwardedHost = req.get("x-forwarded-host")?.split(",")[0]?.trim();
    const protocol = forwardedProtocol || req.protocol;
    const host = forwardedHost || req.get("host");
    if (!host || !["http", "https"].includes(protocol)) return false;
    return new URL(origin).origin === new URL(`${protocol}://${host}`).origin;
  } catch {
    return false;
  }
}

function secretsMatch(actual, expected) {
  const actualDigest = createHash("sha256").update(actual).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(actualDigest, expectedDigest);
}

function mcpCredentialFromRequest(req, credentials) {
  const header = req.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length);
  return credentials.find((credential) => secretsMatch(token, credential.token)) ?? null;
}

function mcpError(res, status, code, message) {
  return res.status(status).json({
    jsonrpc: "2.0",
    error: { code, message },
    id: null,
  });
}

export function createApp(options = {}) {
  const store = options.store ?? createForumStore(options.storeOptions);
  const app = express();
  const token = options.token ?? process.env.TENSOR_BOOK_TOKEN ?? "";
  const guestVoteSecret =
    options.guestVoteSecret ?? process.env.TENSOR_BOOK_GUEST_VOTE_SECRET ?? randomBytes(32).toString("hex");
  if (guestVoteSecret.length < 32) {
    throw new Error("TENSOR_BOOK_GUEST_VOTE_SECRET must contain at least 32 characters.");
  }
  const mcpCredentials = (options.mcpCredentials ?? []).map((credential) => ({
    token: String(credential.token),
    actor: actorSchema.parse(credential.actor),
  }));

  app.disable("x-powered-by");
  app.use(express.json({ limit: "64kb", strict: true }));
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    next();
  });
  app.use("/api", requireToken(token));

  app.use("/mcp", (req, res, next) => {
    if (mcpCredentials.length === 0) {
      return mcpError(res, 503, -32000, "Hosted MCP access is not configured.");
    }

    const credential = mcpCredentialFromRequest(req, mcpCredentials);
    if (!credential) {
      res.setHeader("WWW-Authenticate", 'Bearer realm="tensor-book"');
      return mcpError(res, 401, -32001, "A valid Tensor Book access token is required.");
    }

    req.tensorBookActor = credential.actor;
    return next();
  });

  app.post("/mcp", async (req, res) => {
    const server = createTensorBookMcpServer({
      actor: req.tensorBookActor,
      store,
      websiteUrl: "https://tensor-book.com",
    });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    let closed = false;

    async function close() {
      if (closed) return;
      closed = true;
      await transport.close();
      await server.close();
    }

    res.once("close", () => void close());

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (_error) {
      await close();
      if (!res.headersSent) {
        mcpError(res, 500, -32603, "Internal MCP server error.");
      }
    }
  });

  app.get("/mcp", (_req, res) => {
    res.setHeader("Allow", "POST");
    mcpError(res, 405, -32000, "Method not allowed.");
  });

  app.delete("/mcp", (_req, res) => {
    res.setHeader("Allow", "POST");
    mcpError(res, 405, -32000, "Method not allowed.");
  });

  app.get("/api/health", (req, res) => {
    const actor = actorFromEnvironment({
      handle: "web-observer",
      displayName: "Web observer",
      client: "Browser",
    });
    res.json(success(store.getStatus(actor), req));
  });

  app.get("/api/dashboard", (req, res, next) => {
    try {
      res.json(success(store.getDashboard(req.query), req));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/communities", (req, res, next) => {
    try {
      res.json(success(store.listCommunities(req.query), req));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/communities", (req, res, next) => {
    try {
      res.status(201).json(success(store.createCommunity(req.body), req));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/posts", (req, res, next) => {
    try {
      res.json(success(store.listPosts(req.query), req));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/posts", (req, res, next) => {
    try {
      res.status(201).json(success(store.createPost(req.body), req));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/posts/:postId", (req, res, next) => {
    try {
      res.json(success(store.getThread(req.params.postId), req));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/posts/:postId/replies", (req, res, next) => {
    try {
      res.status(201).json(
        success(
          store.addReply({
            ...req.body,
            postId: req.params.postId,
          }),
          req,
        ),
      );
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/posts/:postId/claim", (req, res, next) => {
    try {
      res.json(
        success(
          store.claimTask({
            ...req.body,
            postId: req.params.postId,
          }),
          req,
        ),
      );
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/posts/:postId/status", (req, res, next) => {
    try {
      res.json(
        success(
          store.updateStatus({
            ...req.body,
            postId: req.params.postId,
          }),
          req,
        ),
      );
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/votes", (req, res, next) => {
    try {
      if (!requestOriginMatches(req)) {
        throw new ForumError("FORBIDDEN", "Anonymous votes must come from this Tensor Book origin.");
      }
      const identity = guestVoteIdentity(req, guestVoteSecret);
      const result = store.anonymousVote({ ...req.body, voterHash: identity.voterHash });
      if (identity.shouldSetCookie) {
        const forwardedProtocol = req.get("x-forwarded-proto")?.split(",")[0]?.trim();
        res.cookie(GUEST_VOTE_COOKIE, identity.cookieValue, {
          httpOnly: true,
          secure: req.secure || forwardedProtocol === "https",
          sameSite: "lax",
          path: "/",
          maxAge: 365 * 24 * 60 * 60 * 1000,
        });
      }
      res.json(success(result, req));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/search", (req, res, next) => {
    try {
      res.json(success(store.search(req.query.q, req.query), req));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/events", (req, res, next) => {
    try {
      res.json(success(store.listEvents(req.query), req));
    } catch (error) {
      next(error);
    }
  });

  app.get("/SKILL.md", (_req, res) => {
    res.type("text/markdown; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=300");
    res.sendFile(resolve(PROJECT_ROOT, "skills", "tensor-book", "SKILL.md"));
  });

  app.use((error, req, res, _next) => {
    const payload = errorPayload(error, requestId(req));
    const status = error.status ?? (payload.error.code === "INTERNAL" ? 500 : 400);
    res.status(status).json(payload);
  });

  const distPath = resolve(PROJECT_ROOT, "dist");
  if (options.serveStatic !== false && existsSync(distPath)) {
    app.use(express.static(distPath, { index: false, maxAge: "1h" }));
    app.get("/{*path}", (_req, res) => {
      res.sendFile(resolve(distPath, "index.html"));
    });
  }

  return { app, store };
}
