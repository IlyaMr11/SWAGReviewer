import assert from "node:assert/strict";
import test from "node:test";
import request from "supertest";
import { createApp } from "../../src/app.js";

test("full backend flow: sync -> job -> results -> publish -> feedback", async () => {
  const app = createApp({
    apiServiceToken: null,
    githubWebhookSecret: null,
  });

  const reposResponse = await request(app).get("/repos").expect(200);
  const repoId = reposResponse.body.items[0]?.id as string;

  assert.ok(repoId);

  const syncResponse = await request(app)
    .post(`/repos/${repoId}/prs/55/sync`)
    .send({})
    .expect(200);

  const prId = syncResponse.body.prId as string;
  const snapshotId = syncResponse.body.snapshotId as string;

  assert.ok(prId);
  assert.ok(snapshotId);

  const jobResponse = await request(app)
    .post(`/prs/${prId}/analysis-jobs`)
    .send({
      snapshotId,
      scope: ["security", "bugs"],
      maxComments: 10,
    })
    .expect(201);

  const jobId = jobResponse.body.jobId as string;
  assert.ok(jobId);

  const resultsResponse = await request(app).get(`/analysis-jobs/${jobId}/results`).expect(200);
  assert.ok(resultsResponse.body.items.length > 0);

  const eventsResponse = await request(app).get(`/analysis-jobs/${jobId}/events`).expect(200);
  assert.ok(eventsResponse.body.items.length > 0);

  const publishResponse = await request(app)
    .post(`/prs/${prId}/publish`)
    .send({
      jobId,
      mode: "review_comments",
      dryRun: false,
    })
    .expect(200);

  assert.ok(publishResponse.body.publishedCount > 0);
  const commentId = publishResponse.body.comments[0]?.id as string;
  assert.ok(commentId);

  const feedbackResponse = await request(app)
    .put(`/comments/${commentId}/feedback`)
    .send({
      userId: "dev_flow",
      vote: "up",
      reason: "useful",
    })
    .expect(200);

  assert.equal(feedbackResponse.body.vote, "up");

  const summaryResponse = await request(app).get(`/prs/${prId}/feedback-summary`).expect(200);
  assert.equal(summaryResponse.body.overall.up, 1);

  const runsResponse = await request(app).get(`/repos/${repoId}/runs`).expect(200);
  assert.ok(runsResponse.body.items.length > 0);
  assert.equal(runsResponse.body.items[0].jobId, jobId);
});
