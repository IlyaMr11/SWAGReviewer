import assert from "node:assert/strict";
import test from "node:test";
import request from "supertest";
import { createApp } from "../../src/app.js";

const MOCK_TOKEN = "ghp_mock_token";

test("github session routes: connect -> repos -> prs -> sync", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockGithubFetch as typeof fetch;

  try {
    const app = createApp({
      apiServiceToken: null,
      githubWebhookSecret: null,
    });

    const sessionResponse = await request(app)
      .post("/github/session")
      .send({ token: MOCK_TOKEN })
      .expect(201);

    const sessionId = sessionResponse.body.sessionId as string;
    assert.ok(sessionId);
    assert.equal(sessionResponse.body.githubLogin, "IlyaMr11");

    const reposResponse = await request(app).get(`/github/session/${sessionId}/repos`).expect(200);
    assert.ok(reposResponse.body.items.length >= 1);

    const repo = reposResponse.body.items.find((item: { fullName: string }) => item.fullName === "IlyaMr11/MIApp");
    assert.ok(repo);

    const prsResponse = await request(app)
      .get(`/github/session/${sessionId}/repos/IlyaMr11/MIApp/prs?state=open`)
      .expect(200);

    assert.equal(prsResponse.body.count, 1);
    assert.equal(prsResponse.body.items[0]?.number, 30);

    const syncResponse = await request(app)
      .post(`/github/session/${sessionId}/repos/IlyaMr11/MIApp/prs/30/sync`)
      .send({})
      .expect(200);

    assert.ok(syncResponse.body.prId);
    assert.ok(syncResponse.body.snapshotId);
    assert.equal(syncResponse.body.counts.files, 2);

    await request(app).delete(`/github/session/${sessionId}`).expect(204);
    await request(app).get(`/github/session/${sessionId}`).expect(404);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

async function mockGithubFetch(input: string | URL | Request): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

  if (url === "https://api.github.com/user") {
    return jsonResponse({ login: "IlyaMr11" });
  }

  if (url.startsWith("https://api.github.com/user/repos")) {
    return jsonResponse([
      {
        id: 101,
        name: "MIApp",
        full_name: "IlyaMr11/MIApp",
        default_branch: "main",
        private: true,
        owner: { login: "IlyaMr11" },
      },
      {
        id: 102,
        name: "SWAGReviewer",
        full_name: "IlyaMr11/SWAGReviewer",
        default_branch: "main",
        private: false,
        owner: { login: "IlyaMr11" },
      },
    ]);
  }

  if (url === "https://api.github.com/repos/IlyaMr11/MIApp/pulls?state=open&per_page=100") {
    return jsonResponse([
      {
        number: 30,
        title: "Improve auth flow",
        state: "open",
        html_url: "https://github.com/IlyaMr11/MIApp/pull/30",
        user: { login: "IlyaMr11" },
        base: { sha: "base_sha_123" },
        head: { sha: "head_sha_456" },
        updated_at: "2026-02-26T10:00:00.000Z",
      },
    ]);
  }

  if (url === "https://api.github.com/repos/IlyaMr11/MIApp/pulls/30") {
    return jsonResponse({
      number: 30,
      title: "Improve auth flow",
      state: "open",
      html_url: "https://github.com/IlyaMr11/MIApp/pull/30",
      user: { login: "IlyaMr11" },
      base: { sha: "base_sha_123" },
      head: { sha: "head_sha_456" },
      updated_at: "2026-02-26T10:00:00.000Z",
    });
  }

  if (url === "https://api.github.com/repos/IlyaMr11/MIApp/pulls/30/files?per_page=100&page=1") {
    return jsonResponse([
      {
        filename: "src/auth.ts",
        status: "modified",
        additions: 3,
        deletions: 1,
        patch: "@@ -1,2 +1,4 @@\n-old\n+new\n+new2",
      },
      {
        filename: "src/ui/Login.tsx",
        status: "added",
        additions: 10,
        deletions: 0,
        patch: "@@ -0,0 +1,2 @@\n+const a = 1;\n+export default a;",
      },
    ]);
  }

  return new Response(JSON.stringify({ message: `Unknown mock URL: ${url}` }), {
    status: 404,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
    },
  });
}
