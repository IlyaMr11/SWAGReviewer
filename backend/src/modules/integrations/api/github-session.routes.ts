import { randomUUID } from "node:crypto";
import { Router } from "express";
import { store } from "../../../platform/db/in-memory-store.js";
import { asyncHandler } from "../../../platform/http/async-handler.js";
import { HttpError } from "../../../shared/errors/http-error.js";
import { paginate } from "../../../shared/utils/pagination.js";
import { githubSessionStore } from "../domain/github-session-store.js";

interface GithubUser {
  login: string;
}

interface GithubRepo {
  id: number;
  name: string;
  full_name: string;
  default_branch: string;
  private: boolean;
  owner: {
    login: string;
  };
}

interface GithubPullRequest {
  number: number;
  title: string;
  state: "open" | "closed";
  html_url: string;
  user: {
    login: string;
  };
  base: {
    sha: string;
  };
  head: {
    sha: string;
  };
  updated_at: string;
}

interface GithubPullFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
}

interface GithubSessionRoutesOptions {
  fetchImpl?: typeof fetch;
}

export function createGithubSessionRoutes(options: GithubSessionRoutesOptions = {}) {
  const router = Router();
  const fetchImpl = options.fetchImpl ?? fetch;

  router.post("/github/session", asyncHandler(async (req, res) => {
    const token = String(req.body?.token ?? "").trim();
    if (!token) {
      throw new HttpError(400, "validation_error", "token is required");
    }

    const githubUser = await githubRequest<GithubUser>(fetchImpl, token, "https://api.github.com/user");
    const session = githubSessionStore.create(token, githubUser.login);

    res.status(201).json({
      sessionId: session.id,
      githubLogin: session.githubLogin,
      expiresAt: session.expiresAt,
    });
  }));

  router.get("/github/session/:sessionId", (req, res) => {
    const session = githubSessionStore.get(String(req.params.sessionId));
    res.status(200).json({
      sessionId: session.id,
      githubLogin: session.githubLogin,
      expiresAt: session.expiresAt,
      createdAt: session.createdAt,
    });
  });

  router.delete("/github/session/:sessionId", (req, res) => {
    githubSessionStore.delete(String(req.params.sessionId));
    res.status(204).send();
  });

  router.get("/github/session/:sessionId/repos", asyncHandler(async (req, res) => {
    const session = githubSessionStore.get(String(req.params.sessionId));
    const repos = await fetchUserRepos(fetchImpl, session.token);

    const normalized = repos.map((repo) => {
      const backendRepo = store.upsertRepository({
        owner: repo.owner.login,
        name: repo.name,
        fullName: repo.full_name,
        defaultBranch: repo.default_branch,
        accountLogin: session.githubLogin,
      });

      return {
        repoId: backendRepo.id,
        providerRepoId: repo.id,
        owner: repo.owner.login,
        name: repo.name,
        fullName: repo.full_name,
        defaultBranch: repo.default_branch,
        private: repo.private,
      };
    });

    const page = paginate(normalized, req.query.cursor, req.query.limit);

    res.status(200).json({
      items: page.items,
      nextCursor: page.nextCursor,
      limit: page.limit,
    });
  }));

  router.get("/github/session/:sessionId/repos/:owner/:repo/prs", asyncHandler(async (req, res) => {
    const session = githubSessionStore.get(String(req.params.sessionId));
    const owner = String(req.params.owner);
    const repo = String(req.params.repo);
    const state = normalizePrState(req.query.state);

    const prs = await githubRequest<GithubPullRequest[]>(
      fetchImpl,
      session.token,
      `https://api.github.com/repos/${owner}/${repo}/pulls?state=${state}&per_page=100`,
    );

    res.status(200).json({
      items: prs.map((pr) => ({
        number: pr.number,
        title: pr.title,
        state: pr.state,
        url: pr.html_url,
        authorLogin: pr.user.login,
        baseSha: pr.base.sha,
        headSha: pr.head.sha,
        updatedAt: pr.updated_at,
      })),
      count: prs.length,
    });
  }));

  router.post("/github/session/:sessionId/repos/:owner/:repo/prs/:prNumber/sync", asyncHandler(async (req, res) => {
    const session = githubSessionStore.get(String(req.params.sessionId));
    const owner = String(req.params.owner);
    const repo = String(req.params.repo);
    const prNumber = Number(req.params.prNumber);

    if (!Number.isFinite(prNumber) || prNumber <= 0) {
      throw new HttpError(400, "validation_error", "prNumber must be a positive integer");
    }

    const [pr, files] = await Promise.all([
      githubRequest<GithubPullRequest>(
        fetchImpl,
        session.token,
        `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`,
      ),
      fetchPullFiles(fetchImpl, session.token, owner, repo, prNumber),
    ]);

    const backendRepo = store.upsertRepository({
      owner,
      name: repo,
      fullName: `${owner}/${repo}`,
      defaultBranch: "main",
      accountLogin: session.githubLogin,
    });

    const syncResult = store.syncPullRequest(backendRepo.id, pr.number, {
      title: pr.title,
      state: pr.state === "open" ? "open" : "closed",
      authorLogin: pr.user.login,
      url: pr.html_url,
      baseSha: pr.base.sha,
      headSha: pr.head.sha,
      commitSha: pr.head.sha,
      files: files.slice(0, 500).map((file) => ({
        path: file.filename,
        status: mapFileStatus(file.status),
        patch: file.patch ?? "",
        additions: file.additions,
        deletions: file.deletions,
      })),
    });

    res.status(200).json({
      repoId: backendRepo.id,
      prId: syncResult.pr.id,
      snapshotId: syncResult.snapshot.id,
      counts: syncResult.counts,
      idempotent: syncResult.idempotent,
      source: "github_session",
    });
  }));

  return router;
}

async function fetchPullFiles(
  fetchImpl: typeof fetch,
  token: string,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<GithubPullFile[]> {
  const items: GithubPullFile[] = [];

  for (let page = 1; page <= 20; page += 1) {
    const chunk = await githubRequest<GithubPullFile[]>(
      fetchImpl,
      token,
      `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/files?per_page=100&page=${page}`,
    );

    if (chunk.length === 0) {
      break;
    }

    items.push(...chunk);

    if (chunk.length < 100) {
      break;
    }
  }

  return items;
}

async function fetchUserRepos(fetchImpl: typeof fetch, token: string): Promise<GithubRepo[]> {
  const repos: GithubRepo[] = [];

  for (let page = 1; page <= 10; page += 1) {
    const chunk = await githubRequest<GithubRepo[]>(
      fetchImpl,
      token,
      `https://api.github.com/user/repos?sort=updated&per_page=100&page=${page}`,
    );

    if (chunk.length === 0) {
      break;
    }

    repos.push(...chunk);

    if (chunk.length < 100) {
      break;
    }
  }

  return repos;
}

function normalizePrState(value: unknown): "open" | "closed" | "all" {
  if (value === "closed") {
    return "closed";
  }
  if (value === "all") {
    return "all";
  }
  return "open";
}

function mapFileStatus(status: string): "added" | "modified" | "removed" | "renamed" {
  if (status === "added") {
    return "added";
  }
  if (status === "removed") {
    return "removed";
  }
  if (status === "renamed") {
    return "renamed";
  }
  return "modified";
}

async function githubRequest<T>(fetchImpl: typeof fetch, token: string, url: string): Promise<T> {
  const response = await fetchImpl(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": `SWAGReviewer/${randomUUID().slice(0, 8)}`,
    },
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message = typeof data?.message === "string" ? data.message : response.statusText;
    throw new HttpError(response.status, "github_api_error", `GitHub API error: ${message}`, {
      url,
      status: response.status,
    });
  }

  return data as T;
}
