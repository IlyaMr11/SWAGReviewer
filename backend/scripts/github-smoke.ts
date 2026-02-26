/*
  Smoke test for real GitHub PR ingestion into local backend.

  Required env:
  - GITHUB_TOKEN
  - GH_OWNER
  - GH_REPO
  - GH_PR_NUMBER

  Optional env:
  - BACKEND_BASE_URL (default: http://localhost:4000)
  - API_SERVICE_TOKEN
  - GITHUB_INSTALLATION_ID (default: 999001)
  - GITHUB_ACCOUNT_LOGIN (default: GH_OWNER)
  - PUBLISH_DRY_RUN (default: true)
*/

interface GitHubUser {
  login: string;
}

interface GitHubRepo {
  full_name: string;
  private: boolean;
}

interface GitHubPullRequest {
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
}

interface GitHubPullFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
}

interface BackendPage<T> {
  items: T[];
  nextCursor: string | null;
  limit: number;
}

interface BackendRepo {
  id: string;
  owner: string;
  fullName: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText} for ${url}\n${JSON.stringify(data, null, 2)}`);
  }

  return data as T;
}

function mapFileStatus(status: string): "added" | "modified" | "removed" | "renamed" {
  switch (status) {
    case "added":
      return "added";
    case "removed":
      return "removed";
    case "renamed":
      return "renamed";
    case "modified":
    default:
      return "modified";
  }
}

async function fetchPrFiles(
  owner: string,
  repo: string,
  prNumber: number,
  ghHeaders: Record<string, string>,
): Promise<GitHubPullFile[]> {
  const out: GitHubPullFile[] = [];
  let page = 1;

  while (true) {
    const url = `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/files?per_page=100&page=${page}`;
    const chunk = await requestJson<GitHubPullFile[]>(url, { headers: ghHeaders });

    if (chunk.length === 0) {
      break;
    }

    out.push(...chunk);

    if (chunk.length < 100) {
      break;
    }

    page += 1;
  }

  return out;
}

async function main() {
  const githubToken = requireEnv("GITHUB_TOKEN");
  const owner = requireEnv("GH_OWNER");
  const repo = requireEnv("GH_REPO");
  const prNumber = Number(requireEnv("GH_PR_NUMBER"));

  if (!Number.isFinite(prNumber) || prNumber <= 0) {
    throw new Error("GH_PR_NUMBER must be a positive integer");
  }

  const backendBaseUrl = process.env.BACKEND_BASE_URL ?? "http://localhost:4000";
  const apiServiceToken = process.env.API_SERVICE_TOKEN;
  const installationId = Number(process.env.GITHUB_INSTALLATION_ID ?? 999001);
  const accountLogin = process.env.GITHUB_ACCOUNT_LOGIN ?? owner;
  const publishDryRun = (process.env.PUBLISH_DRY_RUN ?? "true").toLowerCase() !== "false";

  const ghHeaders: Record<string, string> = {
    Authorization: `Bearer ${githubToken}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "SWAGReviewer-Smoke",
  };

  const backendHeaders: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (apiServiceToken) {
    backendHeaders.Authorization = `Bearer ${apiServiceToken}`;
  }

  console.log("[1/8] Validating GitHub token...");
  const user = await requestJson<GitHubUser>("https://api.github.com/user", { headers: ghHeaders });
  console.log(`GitHub user: ${user.login}`);

  console.log("[2/8] Reading sample repos from your account...");
  const repos = await requestJson<GitHubRepo[]>("https://api.github.com/user/repos?per_page=5&sort=updated", {
    headers: ghHeaders,
  });
  for (const item of repos) {
    console.log(`- ${item.full_name}${item.private ? " (private)" : ""}`);
  }

  console.log(`[3/8] Fetching PR ${owner}/${repo}#${prNumber}...`);
  const pr = await requestJson<GitHubPullRequest>(
    `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`,
    { headers: ghHeaders },
  );

  console.log("[4/8] Fetching changed files...");
  const prFiles = await fetchPrFiles(owner, repo, prNumber, ghHeaders);
  console.log(`Changed files in PR: ${prFiles.length}`);

  console.log("[5/8] Registering installation in local backend...");
  await requestJson<{ installation: unknown }>(`${backendBaseUrl}/integrations/github/install`, {
    method: "POST",
    headers: backendHeaders,
    body: JSON.stringify({
      installation_id: installationId,
      account_login: accountLogin,
    }),
  });

  const backendRepos = await requestJson<BackendPage<BackendRepo>>(`${backendBaseUrl}/repos`, {
    headers: apiServiceToken ? { Authorization: `Bearer ${apiServiceToken}` } : undefined,
  });

  const targetRepo = backendRepos.items.find((item) => item.owner === accountLogin) ?? backendRepos.items[0];
  if (!targetRepo) {
    throw new Error("No repos available in backend after installation registration");
  }

  console.log(`[6/8] Syncing PR into backend repoId=${targetRepo.id}...`);
  const syncPayload = {
    title: pr.title,
    state: pr.state === "open" ? "open" : "closed",
    authorLogin: pr.user.login,
    url: pr.html_url,
    baseSha: pr.base.sha,
    headSha: pr.head.sha,
    commitSha: pr.head.sha,
    files: prFiles.slice(0, 500).map((file) => ({
      path: file.filename,
      status: mapFileStatus(file.status),
      patch: file.patch ?? "",
      additions: file.additions,
      deletions: file.deletions,
    })),
  };

  const syncResponse = await requestJson<{ prId: string; snapshotId: string; counts: { files: number } }>(
    `${backendBaseUrl}/repos/${targetRepo.id}/prs/${pr.number}/sync`,
    {
      method: "POST",
      headers: backendHeaders,
      body: JSON.stringify(syncPayload),
    },
  );

  console.log(`[7/8] Running analysis job for prId=${syncResponse.prId}...`);
  const job = await requestJson<{ jobId: string; status: string }>(`${backendBaseUrl}/prs/${syncResponse.prId}/analysis-jobs`, {
    method: "POST",
    headers: backendHeaders,
    body: JSON.stringify({
      snapshotId: syncResponse.snapshotId,
      scope: ["security", "bugs", "style"],
      maxComments: 30,
    }),
  });

  const results = await requestJson<BackendPage<{ id: string; title: string; category: string }>>(
    `${backendBaseUrl}/analysis-jobs/${job.jobId}/results`,
    {
      headers: apiServiceToken ? { Authorization: `Bearer ${apiServiceToken}` } : undefined,
    },
  );

  console.log(`[8/8] Publishing (dryRun=${publishDryRun})...`);
  const publish = await requestJson<{ publishedCount: number; idempotent: boolean }>(
    `${backendBaseUrl}/prs/${syncResponse.prId}/publish`,
    {
      method: "POST",
      headers: backendHeaders,
      body: JSON.stringify({
        jobId: job.jobId,
        mode: "review_comments",
        dryRun: publishDryRun,
      }),
    },
  );

  console.log("\nSmoke test completed:");
  console.log(`- PR synced: ${syncResponse.prId}`);
  console.log(`- Snapshot: ${syncResponse.snapshotId}, files=${syncResponse.counts.files}`);
  console.log(`- Job: ${job.jobId}, status=${job.status}`);
  console.log(`- Suggestions: ${results.items.length}`);
  if (results.items.length > 0) {
    console.log(`- First suggestion: [${results.items[0]?.category}] ${results.items[0]?.title}`);
  }
  console.log(`- Published: ${publish.publishedCount} (idempotent=${publish.idempotent})`);
}

main().catch((error) => {
  console.error("Smoke test failed:");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
