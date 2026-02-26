import { randomUUID } from "node:crypto";
import {
  analyzeWithRag,
  type RagAnalyzeRequest,
} from "../../modules/analysis-orchestrator/domain/rag-adapter.js";
import { rerankSuggestions } from "../../modules/adaptation/domain/rerank.js";
import { countPatchChanges, detectLanguage, parseUnifiedDiff } from "../../modules/diff/domain/unified-diff.js";
import { HttpError } from "../../shared/errors/http-error.js";
import type {
  AnalysisJob,
  AnalysisJobEvent,
  AnalysisJobEventLevel,
  AnalysisJobInput,
  CursorPage,
  FeedbackVote,
  FeedbackVoteValue,
  FileStatus,
  GithubInstallation,
  PRSnapshot,
  PublishMode,
  PublishedComment,
  PullRequest,
  Repository,
  RepoRunSummary,
  SnapshotFile,
  Suggestion,
  SuggestionCategory,
  SyncFileInput,
  SyncPrInput,
} from "../../shared/types/contracts.js";
import { normalizeTitle, sha256 } from "../../shared/utils/hash.js";
import { paginate } from "../../shared/utils/pagination.js";

const MAX_SYNC_FILES = 500;
const PATCH_CAP_BYTES = 300 * 1024;

interface PublishRun {
  id: string;
  key: string;
  prId: string;
  jobId: string;
  mode: PublishMode;
  dryRun: boolean;
  publishedCommentIds: string[];
  errors: string[];
  createdAt: string;
}

export class InMemoryStore {
  private readonly installations = new Map<string, GithubInstallation>();
  private readonly repositories = new Map<string, Repository>();
  private readonly pullRequests = new Map<string, PullRequest>();
  private readonly snapshots = new Map<string, PRSnapshot>();
  private readonly snapshotFiles = new Map<string, SnapshotFile>();
  private readonly snapshotFilesBySnapshot = new Map<string, string[]>();
  private readonly jobs = new Map<string, AnalysisJob>();
  private readonly jobsByPr = new Map<string, string[]>();
  private readonly jobEventsByJob = new Map<string, string[]>();
  private readonly jobEvents = new Map<string, AnalysisJobEvent>();
  private readonly suggestions = new Map<string, Suggestion>();
  private readonly suggestionsByJob = new Map<string, string[]>();
  private readonly comments = new Map<string, PublishedComment>();
  private readonly commentsByPr = new Map<string, string[]>();
  private readonly feedbackVotes = new Map<string, FeedbackVote>();
  private readonly feedbackByComment = new Map<string, string[]>();
  private readonly publishRuns = new Map<string, PublishRun>();

  constructor() {
    this.seed();
  }

  private now(): string {
    return new Date().toISOString();
  }

  private seed() {
    const now = this.now();

    const installation: GithubInstallation = {
      id: "inst_demo",
      installationId: 123456,
      accountLogin: "acme-org",
      createdAt: now,
      updatedAt: now,
    };

    const repo: Repository = {
      id: "repo_demo",
      provider: "github",
      installationId: installation.id,
      owner: "acme-org",
      name: "demo-service",
      fullName: "acme-org/demo-service",
      defaultBranch: "main",
      createdAt: now,
      updatedAt: now,
    };

    this.installations.set(installation.id, installation);
    this.repositories.set(repo.id, repo);
  }

  upsertGithubInstallation(installationId: number, accountLogin: string): GithubInstallation {
    const existing = [...this.installations.values()].find((item) => item.installationId === installationId);
    const now = this.now();

    if (existing) {
      existing.accountLogin = accountLogin;
      existing.updatedAt = now;
      return existing;
    }

    const created: GithubInstallation = {
      id: `inst_${randomUUID()}`,
      installationId,
      accountLogin,
      createdAt: now,
      updatedAt: now,
    };

    this.installations.set(created.id, created);

    const repo: Repository = {
      id: `repo_${randomUUID()}`,
      provider: "github",
      installationId: created.id,
      owner: accountLogin,
      name: `repo-${String(installationId).slice(-4)}`,
      fullName: `${accountLogin}/repo-${String(installationId).slice(-4)}`,
      defaultBranch: "main",
      createdAt: now,
      updatedAt: now,
    };
    this.repositories.set(repo.id, repo);

    return created;
  }

  upsertRepository(input: {
    owner: string;
    name: string;
    fullName: string;
    defaultBranch: string;
    accountLogin: string;
  }): Repository {
    const now = this.now();
    const existing = [...this.repositories.values()].find((item) => item.fullName === input.fullName);

    if (existing) {
      existing.owner = input.owner;
      existing.name = input.name;
      existing.defaultBranch = input.defaultBranch;
      existing.updatedAt = now;
      return existing;
    }

    let installation = [...this.installations.values()].find((item) => item.accountLogin === input.accountLogin);

    if (!installation) {
      installation = this.upsertGithubInstallation(randomInstallationId(), input.accountLogin);
    }

    const created: Repository = {
      id: `repo_${randomUUID()}`,
      provider: "github",
      installationId: installation.id,
      owner: input.owner,
      name: input.name,
      fullName: input.fullName,
      defaultBranch: input.defaultBranch,
      createdAt: now,
      updatedAt: now,
    };

    this.repositories.set(created.id, created);

    return created;
  }

  listRepos(cursor: unknown, limit: unknown): CursorPage<Repository> {
    const sorted = [...this.repositories.values()].sort((a, b) => a.fullName.localeCompare(b.fullName));
    return paginate(sorted, cursor, limit);
  }

  getRepo(repoId: string): Repository {
    const repo = this.repositories.get(repoId);
    if (!repo) {
      throw new HttpError(404, "repo_not_found", `Repository not found: ${repoId}`);
    }
    return repo;
  }

  syncPullRequest(repoId: string, prNumber: number, input: SyncPrInput | undefined) {
    const repo = this.getRepo(repoId);
    const now = this.now();
    const pr = this.getOrCreatePr(repo.id, prNumber, input);

    const headSha = input?.headSha ?? pr.headSha;
    const baseSha = input?.baseSha ?? pr.baseSha;
    const commitSha = input?.commitSha ?? headSha;

    const latestSnapshot = pr.latestSnapshotId ? this.snapshots.get(pr.latestSnapshotId) : null;
    if (latestSnapshot && latestSnapshot.headSha === headSha) {
      return {
        pr,
        snapshot: latestSnapshot,
        counts: {
          files: latestSnapshot.filesCount,
          additions: latestSnapshot.additions,
          deletions: latestSnapshot.deletions,
        },
        idempotent: true,
      };
    }

    const filesInput = input?.files?.length ? input.files : generateDefaultSyncFiles(pr.number);
    if (filesInput.length > MAX_SYNC_FILES) {
      throw new HttpError(422, "sync_limit_exceeded", `PR has ${filesInput.length} files, limit is ${MAX_SYNC_FILES}`);
    }

    const snapshotId = `snap_${randomUUID()}`;
    let additions = 0;
    let deletions = 0;

    const snapshot: PRSnapshot = {
      id: snapshotId,
      prId: pr.id,
      commitSha,
      baseSha,
      headSha,
      filesCount: filesInput.length,
      additions: 0,
      deletions: 0,
      createdAt: now,
    };

    this.snapshots.set(snapshot.id, snapshot);
    this.snapshotFilesBySnapshot.set(snapshot.id, []);

    for (const fileInput of filesInput) {
      const normalized = this.buildSnapshotFile(snapshot.id, fileInput, now);
      additions += normalized.additions;
      deletions += normalized.deletions;

      this.snapshotFiles.set(normalized.id, normalized);
      this.snapshotFilesBySnapshot.get(snapshot.id)?.push(normalized.id);
    }

    snapshot.additions = additions;
    snapshot.deletions = deletions;

    pr.baseSha = baseSha;
    pr.headSha = headSha;
    pr.latestSnapshotId = snapshot.id;
    pr.updatedAt = now;

    if (input?.title) {
      pr.title = input.title;
    }
    if (input?.state) {
      pr.state = input.state;
    }
    if (input?.authorLogin) {
      pr.authorLogin = input.authorLogin;
    }
    if (input?.url) {
      pr.url = input.url;
    }

    return {
      pr,
      snapshot,
      counts: {
        files: snapshot.filesCount,
        additions,
        deletions,
      },
      idempotent: false,
    };
  }

  private getOrCreatePr(repoId: string, number: number, input: SyncPrInput | undefined): PullRequest {
    const existing = [...this.pullRequests.values()].find((item) => item.repoId === repoId && item.number === number);

    if (existing) {
      return existing;
    }

    const now = this.now();
    const pr: PullRequest = {
      id: `pr_${randomUUID()}`,
      repoId,
      number,
      title: input?.title ?? `PR #${number}`,
      state: input?.state ?? "open",
      authorLogin: input?.authorLogin ?? "unknown",
      url: input?.url ?? "https://github.com/",
      baseSha: input?.baseSha ?? randomSha(),
      headSha: input?.headSha ?? randomSha(),
      latestSnapshotId: null,
      createdAt: now,
      updatedAt: now,
    };

    this.pullRequests.set(pr.id, pr);
    this.jobsByPr.set(pr.id, []);
    this.commentsByPr.set(pr.id, []);

    return pr;
  }

  private buildSnapshotFile(snapshotId: string, input: SyncFileInput, now: string): SnapshotFile {
    const patchBytes = Buffer.byteLength(input.patch, "utf8");
    const tooLarge = patchBytes > PATCH_CAP_BYTES;

    const { additions, deletions } = countPatchChanges(input.patch);
    const parsed = tooLarge ? { hunks: [], lineMap: [] } : parseUnifiedDiff(input.patch);

    return {
      id: `file_${randomUUID()}`,
      snapshotId,
      path: input.path,
      status: input.status ?? "modified",
      language: input.language ?? detectLanguage(input.path),
      additions: input.additions ?? additions,
      deletions: input.deletions ?? deletions,
      patch: tooLarge ? "" : input.patch,
      hunks: tooLarge ? undefined : parsed.hunks,
      lineMap: tooLarge ? undefined : parsed.lineMap,
      patchHash: sha256(input.patch),
      isTooLarge: tooLarge,
      createdAt: now,
    };
  }

  getPr(prId: string): PullRequest {
    const pr = this.pullRequests.get(prId);
    if (!pr) {
      throw new HttpError(404, "pr_not_found", `PR not found: ${prId}`);
    }
    return pr;
  }

  listPrFiles(prId: string, cursor: unknown, limit: unknown): CursorPage<SnapshotFile> {
    const pr = this.getPr(prId);
    if (!pr.latestSnapshotId) {
      return paginate([], cursor, limit);
    }

    const ids = this.snapshotFilesBySnapshot.get(pr.latestSnapshotId) ?? [];
    const files = ids.map((id) => this.snapshotFiles.get(id)).filter((item): item is SnapshotFile => Boolean(item));

    return paginate(files, cursor, limit);
  }

  getPrDiff(prId: string, filePath: string | null) {
    const pr = this.getPr(prId);
    if (!pr.latestSnapshotId) {
      throw new HttpError(404, "snapshot_not_found", `No snapshot for PR: ${prId}`);
    }

    const ids = this.snapshotFilesBySnapshot.get(pr.latestSnapshotId) ?? [];
    const files = ids
      .map((id) => this.snapshotFiles.get(id))
      .filter((item): item is SnapshotFile => Boolean(item));

    if (!filePath) {
      return files;
    }

    const file = files.find((item) => item.path === filePath);
    if (!file) {
      throw new HttpError(404, "file_not_found", `File not found in latest snapshot: ${filePath}`);
    }

    return [file];
  }

  listPrSnapshots(prId: string): PRSnapshot[] {
    this.getPr(prId);

    return [...this.snapshots.values()]
      .filter((item) => item.prId === prId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getSnapshot(snapshotId: string) {
    const snapshot = this.snapshots.get(snapshotId);
    if (!snapshot) {
      throw new HttpError(404, "snapshot_not_found", `Snapshot not found: ${snapshotId}`);
    }

    const fileIds = this.snapshotFilesBySnapshot.get(snapshotId) ?? [];
    const files = fileIds
      .map((id) => this.snapshotFiles.get(id))
      .filter((item): item is SnapshotFile => Boolean(item));

    return { snapshot, files };
  }

  async createAnalysisJob(prId: string, input: AnalysisJobInput): Promise<AnalysisJob> {
    const pr = this.getPr(prId);
    const snapshot = this.snapshots.get(input.snapshotId);

    if (!snapshot || snapshot.prId !== pr.id) {
      throw new HttpError(422, "invalid_snapshot", "snapshotId does not belong to this PR");
    }

    const snapshotFileIds = this.snapshotFilesBySnapshot.get(snapshot.id) ?? [];
    const snapshotFiles = snapshotFileIds
      .map((id) => this.snapshotFiles.get(id))
      .filter((item): item is SnapshotFile => Boolean(item));

    const files = input.files?.length
      ? snapshotFiles.filter((file) => input.files?.includes(file.path))
      : snapshotFiles;

    const now = this.now();
    const job: AnalysisJob = {
      id: `job_${randomUUID()}`,
      prId,
      snapshotId: snapshot.id,
      status: "queued",
      scope: input.scope,
      filesFilter: input.files ?? null,
      maxComments: input.maxComments,
      progress: {
        filesDone: 0,
        total: files.length,
      },
      summary: {
        totalSuggestions: 0,
        partialFailures: 0,
        filesSkipped: 0,
        warnings: [],
      },
      errorMessage: null,
      createdAt: now,
      updatedAt: now,
    };

    this.jobs.set(job.id, job);
    this.jobsByPr.get(prId)?.push(job.id);
    this.jobEventsByJob.set(job.id, []);
    this.suggestionsByJob.set(job.id, []);
    this.appendJobEvent(job.id, "info", "Задача анализа создана и поставлена в очередь.");

    await this.runAnalysisJob(job.id, files);

    return this.getJob(job.id);
  }

  private async runAnalysisJob(jobId: string, files: SnapshotFile[]) {
    const job = this.jobs.get(jobId);
    if (!job) {
      return;
    }

    job.status = "running";
    job.updatedAt = this.now();
    this.appendJobEvent(job.id, "info", "Задача анализа запущена.");

    for (const [index, file] of files.entries()) {
      if (file.isTooLarge) {
        this.appendJobEvent(job.id, "warn", "Файл пропущен из-за лимита размера patch.", file.path, {
          index: index + 1,
          total: files.length,
        });
      } else {
        this.appendJobEvent(job.id, "info", "Файл передан в анализ.", file.path, {
          index: index + 1,
          total: files.length,
        });
      }
    }

    const ragRequest: RagAnalyzeRequest = {
      jobId: job.id,
      snapshotId: job.snapshotId,
      scope: job.scope,
      files: files.map((file) => ({
        path: file.path,
        language: file.language,
        patch: file.patch,
        hunks: file.hunks,
        lineMap: file.lineMap,
      })),
      limits: {
        maxComments: job.maxComments,
        maxPerFile: 3,
      },
    };

    try {
      const ragResponse = await analyzeWithRag(ragRequest);
      const now = this.now();

      for (const suggestionInput of ragResponse.suggestions) {
        const fingerprint =
          suggestionInput.fingerprint ??
          sha256(
            `${suggestionInput.filePath}:${suggestionInput.lineStart}:${suggestionInput.lineEnd}:${normalizeTitle(
              suggestionInput.title,
            )}`,
          );

        const duplicated = (this.suggestionsByJob.get(job.id) ?? [])
          .map((id) => this.suggestions.get(id))
          .filter((item): item is Suggestion => Boolean(item))
          .find((item) => item.fingerprint === fingerprint);

        if (duplicated) {
          continue;
        }

        const suggestion: Suggestion = {
          id: `sug_${randomUUID()}`,
          jobId: job.id,
          prId: job.prId,
          snapshotId: job.snapshotId,
          fingerprint,
          filePath: suggestionInput.filePath,
          lineStart: suggestionInput.lineStart,
          lineEnd: suggestionInput.lineEnd,
          severity: suggestionInput.severity,
          category: suggestionInput.category,
          title: suggestionInput.title,
          body: suggestionInput.body,
          citations: suggestionInput.citations,
          confidence: suggestionInput.confidence,
          createdAt: now,
        };

        this.suggestions.set(suggestion.id, suggestion);
        this.suggestionsByJob.get(job.id)?.push(suggestion.id);
      }

      job.progress.filesDone = job.progress.total;
      job.summary.totalSuggestions = this.suggestionsByJob.get(job.id)?.length ?? 0;
      job.summary.partialFailures = ragResponse.partialFailures;
      job.summary.filesSkipped = files.filter((file) => file.isTooLarge).length;
      if (job.summary.filesSkipped > 0) {
        job.summary.warnings.push("Some files were skipped due to patch size limits.");
      }

      job.status = "done";
      job.updatedAt = this.now();
      this.appendJobEvent(job.id, "info", "Анализ завершен.", null, {
        suggestions: job.summary.totalSuggestions,
        partialFailures: job.summary.partialFailures,
        filesSkipped: job.summary.filesSkipped,
      });
    } catch (error) {
      job.status = "failed";
      job.errorMessage = error instanceof Error ? error.message : "Failed to process analysis job";
      job.updatedAt = this.now();
      this.appendJobEvent(job.id, "error", job.errorMessage);
    }
  }

  listPrAnalysisJobs(prId: string, cursor: unknown, limit: unknown): CursorPage<AnalysisJob> {
    this.getPr(prId);
    const ids = this.jobsByPr.get(prId) ?? [];
    const jobs = ids
      .map((id) => this.jobs.get(id))
      .filter((item): item is AnalysisJob => Boolean(item))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    return paginate(jobs, cursor, limit);
  }

  getJob(jobId: string): AnalysisJob {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new HttpError(404, "job_not_found", `Analysis job not found: ${jobId}`);
    }
    return job;
  }

  cancelJob(jobId: string): AnalysisJob {
    const job = this.getJob(jobId);

    if (job.status === "done" || job.status === "failed") {
      return job;
    }

    job.status = "canceled";
    job.updatedAt = this.now();
    this.appendJobEvent(job.id, "warn", "Задача отменена пользователем.");
    return job;
  }

  listJobEvents(jobId: string, cursor: unknown, limit: unknown): CursorPage<AnalysisJobEvent> {
    this.getJob(jobId);
    const ids = this.jobEventsByJob.get(jobId) ?? [];
    const events = ids
      .map((id) => this.jobEvents.get(id))
      .filter((item): item is AnalysisJobEvent => Boolean(item))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    return paginate(events, cursor, limit);
  }

  listJobSuggestions(jobId: string, cursor: unknown, limit: unknown): CursorPage<Suggestion> {
    this.getJob(jobId);

    const ids = this.suggestionsByJob.get(jobId) ?? [];
    const suggestions = ids
      .map((id) => this.suggestions.get(id))
      .filter((item): item is Suggestion => Boolean(item));

    const ranked = rerankSuggestions(suggestions, this.getFeedbackScoreByFingerprint());

    return paginate(ranked, cursor, limit);
  }

  private getFeedbackScoreByFingerprint(): Map<string, number> {
    const scoreByFingerprint = new Map<string, number>();

    for (const comment of this.comments.values()) {
      const suggestion = this.suggestions.get(comment.suggestionId);
      if (!suggestion) {
        continue;
      }

      const voteIds = this.feedbackByComment.get(comment.id) ?? [];
      const votes = voteIds
        .map((id) => this.feedbackVotes.get(id))
        .filter((item): item is FeedbackVote => Boolean(item));

      const score = votes.reduce((acc, vote) => acc + (vote.vote === "up" ? 1 : -1), 0);
      const previous = scoreByFingerprint.get(suggestion.fingerprint) ?? 0;
      scoreByFingerprint.set(suggestion.fingerprint, previous + score);
    }

    return scoreByFingerprint;
  }

  publish(prId: string, jobId: string, mode: PublishMode, dryRun: boolean) {
    const job = this.getJob(jobId);
    if (job.prId !== prId) {
      throw new HttpError(422, "job_pr_mismatch", "jobId does not belong to this PR");
    }

    const idempotencyKey = `${prId}:${jobId}:${mode}`;
    const existingRun = this.publishRuns.get(idempotencyKey);

    if (existingRun) {
      return {
        publishRunId: existingRun.id,
        publishedCount: existingRun.publishedCommentIds.length,
        errors: existingRun.errors,
        comments: existingRun.publishedCommentIds
          .map((id) => this.comments.get(id))
          .filter((item): item is PublishedComment => Boolean(item)),
        idempotent: true,
      };
    }

    const suggestionIds = this.suggestionsByJob.get(job.id) ?? [];
    const suggestions = suggestionIds
      .map((id) => this.suggestions.get(id))
      .filter((item): item is Suggestion => Boolean(item));

    const now = this.now();
    const publishRun: PublishRun = {
      id: `pubrun_${randomUUID()}`,
      key: idempotencyKey,
      prId,
      jobId,
      mode,
      dryRun,
      publishedCommentIds: [],
      errors: [],
      createdAt: now,
    };

    if (!dryRun) {
      for (const suggestion of suggestions) {
        const comment: PublishedComment = {
          id: `cmt_${randomUUID()}`,
          prId,
          jobId,
          suggestionId: suggestion.id,
          providerCommentId: `ghc_${randomUUID().slice(0, 8)}`,
          mode,
          state: "posted",
          filePath: suggestion.filePath,
          lineStart: suggestion.lineStart,
          lineEnd: suggestion.lineEnd,
          body: suggestion.body,
          createdAt: now,
        };

        this.comments.set(comment.id, comment);
        this.commentsByPr.get(prId)?.push(comment.id);
        this.feedbackByComment.set(comment.id, []);
        publishRun.publishedCommentIds.push(comment.id);
      }
    }

    this.publishRuns.set(idempotencyKey, publishRun);

    return {
      publishRunId: publishRun.id,
      publishedCount: publishRun.publishedCommentIds.length,
      errors: publishRun.errors,
      comments: publishRun.publishedCommentIds
        .map((id) => this.comments.get(id))
        .filter((item): item is PublishedComment => Boolean(item)),
      idempotent: false,
    };
  }

  listPrComments(prId: string, cursor: unknown, limit: unknown): CursorPage<PublishedComment> {
    this.getPr(prId);

    const ids = this.commentsByPr.get(prId) ?? [];
    const comments = ids
      .map((id) => this.comments.get(id))
      .filter((item): item is PublishedComment => Boolean(item))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    return paginate(comments, cursor, limit);
  }

  listRepoRuns(repoId: string, cursor: unknown, limit: unknown): CursorPage<RepoRunSummary> {
    const repo = this.getRepo(repoId);
    const prs = [...this.pullRequests.values()].filter((item) => item.repoId === repo.id);
    const runs: RepoRunSummary[] = [];

    for (const pr of prs) {
      const jobIds = this.jobsByPr.get(pr.id) ?? [];
      for (const jobId of jobIds) {
        const job = this.jobs.get(jobId);
        if (!job) {
          continue;
        }

        const suggestionCount = (this.suggestionsByJob.get(job.id) ?? []).length;
        const comments = [...this.comments.values()].filter((comment) => comment.jobId === job.id);

        let feedbackScore = 0;
        for (const comment of comments) {
          const votes = (this.feedbackByComment.get(comment.id) ?? [])
            .map((id) => this.feedbackVotes.get(id))
            .filter((item): item is FeedbackVote => Boolean(item));

          feedbackScore += votes.reduce((acc, vote) => acc + (vote.vote === "up" ? 1 : -1), 0);
        }

        runs.push({
          runId: job.id,
          jobId: job.id,
          repoId: repo.id,
          repoFullName: repo.fullName,
          prId: pr.id,
          prNumber: pr.number,
          prTitle: pr.title,
          status: job.status,
          totalSuggestions: suggestionCount,
          publishedComments: comments.length,
          feedbackScore,
          createdAt: job.createdAt,
          updatedAt: job.updatedAt,
        });
      }
    }

    runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return paginate(runs, cursor, limit);
  }

  upsertFeedback(commentId: string, userId: string, vote: FeedbackVoteValue, reason?: string): FeedbackVote {
    const comment = this.comments.get(commentId);
    if (!comment) {
      throw new HttpError(404, "comment_not_found", `Comment not found: ${commentId}`);
    }

    const voteIds = this.feedbackByComment.get(comment.id) ?? [];
    const existing = voteIds
      .map((id) => this.feedbackVotes.get(id))
      .filter((item): item is FeedbackVote => Boolean(item))
      .find((item) => item.userId === userId);

    const now = this.now();

    if (existing) {
      existing.vote = vote;
      existing.reason = reason ?? null;
      existing.updatedAt = now;
      return existing;
    }

    const feedback: FeedbackVote = {
      id: `fb_${randomUUID()}`,
      commentId,
      userId,
      vote,
      reason: reason ?? null,
      createdAt: now,
      updatedAt: now,
    };

    this.feedbackVotes.set(feedback.id, feedback);

    if (!this.feedbackByComment.has(commentId)) {
      this.feedbackByComment.set(commentId, []);
    }
    this.feedbackByComment.get(commentId)?.push(feedback.id);

    return feedback;
  }

  getCommentFeedback(commentId: string) {
    const comment = this.comments.get(commentId);
    if (!comment) {
      throw new HttpError(404, "comment_not_found", `Comment not found: ${commentId}`);
    }

    const votes = (this.feedbackByComment.get(comment.id) ?? [])
      .map((id) => this.feedbackVotes.get(id))
      .filter((item): item is FeedbackVote => Boolean(item))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

    const up = votes.filter((vote) => vote.vote === "up").length;
    const down = votes.filter((vote) => vote.vote === "down").length;

    return {
      comment,
      votes,
      totals: {
        up,
        down,
        score: up - down,
      },
    };
  }

  getPrFeedbackSummary(prId: string) {
    this.getPr(prId);

    const commentIds = this.commentsByPr.get(prId) ?? [];

    const byFile = new Map<string, { up: number; down: number; score: number; comments: number }>();
    const byCategory = new Map<SuggestionCategory, { up: number; down: number; score: number }>();
    const bySeverity = new Map<string, { up: number; down: number; score: number }>();

    let totalUp = 0;
    let totalDown = 0;

    for (const commentId of commentIds) {
      const comment = this.comments.get(commentId);
      if (!comment) {
        continue;
      }

      const suggestion = this.suggestions.get(comment.suggestionId);
      if (!suggestion) {
        continue;
      }

      const votes = (this.feedbackByComment.get(comment.id) ?? [])
        .map((id) => this.feedbackVotes.get(id))
        .filter((item): item is FeedbackVote => Boolean(item));

      const up = votes.filter((vote) => vote.vote === "up").length;
      const down = votes.filter((vote) => vote.vote === "down").length;
      const score = up - down;

      totalUp += up;
      totalDown += down;

      const fileAgg = byFile.get(comment.filePath) ?? { up: 0, down: 0, score: 0, comments: 0 };
      fileAgg.up += up;
      fileAgg.down += down;
      fileAgg.score += score;
      fileAgg.comments += 1;
      byFile.set(comment.filePath, fileAgg);

      const categoryAgg = byCategory.get(suggestion.category) ?? { up: 0, down: 0, score: 0 };
      categoryAgg.up += up;
      categoryAgg.down += down;
      categoryAgg.score += score;
      byCategory.set(suggestion.category, categoryAgg);

      const severityAgg = bySeverity.get(suggestion.severity) ?? { up: 0, down: 0, score: 0 };
      severityAgg.up += up;
      severityAgg.down += down;
      severityAgg.score += score;
      bySeverity.set(suggestion.severity, severityAgg);
    }

    return {
      prId,
      overall: {
        up: totalUp,
        down: totalDown,
        score: totalUp - totalDown,
      },
      byFile: [...byFile.entries()].map(([filePath, value]) => ({
        filePath,
        ...value,
      })),
      byCategory: [...byCategory.entries()].map(([category, value]) => ({
        category,
        ...value,
      })),
      bySeverity: [...bySeverity.entries()].map(([severity, value]) => ({
        severity,
        ...value,
      })),
    };
  }

  private appendJobEvent(
    jobId: string,
    level: AnalysisJobEventLevel,
    message: string,
    filePath?: string | null,
    meta?: Record<string, unknown>,
  ) {
    const now = this.now();
    const event: AnalysisJobEvent = {
      id: `evt_${randomUUID()}`,
      jobId,
      level,
      message,
      filePath: filePath ?? null,
      meta: meta ?? null,
      createdAt: now,
    };

    this.jobEvents.set(event.id, event);

    if (!this.jobEventsByJob.has(jobId)) {
      this.jobEventsByJob.set(jobId, []);
    }
    this.jobEventsByJob.get(jobId)?.push(event.id);
  }
}

export const store = new InMemoryStore();

function randomSha() {
  return sha256(randomUUID()).slice(0, 40);
}

function randomInstallationId() {
  return Math.floor(1_000_000 + Math.random() * 9_000_000);
}

function generateDefaultSyncFiles(prNumber: number): SyncFileInput[] {
  return [
    {
      path: "src/security/auth.ts",
      status: "modified",
      patch: [
        "@@ -10,6 +10,9 @@ export async function login(userInput) {",
        "-  const query = `SELECT * FROM users WHERE email = '${userInput.email}'`;",
        "+  const query = `SELECT * FROM users WHERE email = $1`;",
        "+  const params = [userInput.email];",
        "+  return db.query(query, params);",
        "   return db.query(query);",
        " }",
      ].join("\n"),
    },
    {
      path: `src/services/pr-${prNumber}.ts`,
      status: "added",
      patch: [
        "@@ -0,0 +1,8 @@",
        "+export function expensiveLoop(items: number[]) {",
        "+  let sum = 0;",
        "+  for (let i = 0; i < items.length; i += 1) {",
        "+    for (let j = 0; j < items.length; j += 1) {",
        "+      sum += items[i] * items[j];",
        "+    }",
        "+  }",
        "+  return sum;",
        "+}",
      ].join("\n"),
    },
  ];
}

export { MAX_SYNC_FILES, PATCH_CAP_BYTES };
