export type SuggestionScope = "security" | "style" | "bugs" | "performance";
export type PublishMode = "review_comments" | "issue_comments";

export interface GithubSession {
  sessionId: string;
  githubLogin: string;
  expiresAt: string;
}

export interface GithubRepo {
  repoId: string;
  providerRepoId: number;
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  private: boolean;
}

export interface GithubPr {
  number: number;
  title: string;
  state: "open" | "closed";
  url: string;
  authorLogin: string;
  baseSha: string;
  headSha: string;
  updatedAt: string;
}

export interface SyncResponse {
  repoId: string;
  prId: string;
  snapshotId: string;
  counts: {
    files: number;
    additions: number;
    deletions: number;
  };
  idempotent: boolean;
  source: string;
}

export interface AnalysisJobCreateResponse {
  jobId: string;
  status: string;
  progress: {
    filesDone: number;
    total: number;
  };
}

export interface AnalysisJob {
  id: string;
  prId: string;
  snapshotId: string;
  status: "queued" | "running" | "done" | "failed" | "canceled";
  scope: SuggestionScope[];
  maxComments: number;
  progress: {
    filesDone: number;
    total: number;
  };
  summary: {
    totalSuggestions: number;
    partialFailures: number;
    filesSkipped: number;
    warnings: string[];
  };
  errorMessage: string | null;
}

export interface Citation {
  sourceId: string;
  title: string;
  url: string;
  snippet: string;
}

export interface Suggestion {
  id: string;
  fingerprint: string;
  filePath: string;
  lineStart: number;
  lineEnd: number;
  severity: "info" | "low" | "medium" | "high" | "critical";
  category: SuggestionScope;
  title: string;
  body: string;
  citations: Citation[];
  confidence: number;
}

export interface PublishedComment {
  id: string;
  prId: string;
  jobId: string;
  suggestionId: string;
  providerCommentId: string | null;
  mode: PublishMode;
  state: "pending" | "posted" | "failed";
  filePath: string;
  lineStart: number;
  lineEnd: number;
  body: string;
  createdAt: string;
}

export interface FeedbackSummary {
  prId: string;
  overall: {
    up: number;
    down: number;
    score: number;
  };
  byFile: Array<{
    filePath: string;
    up: number;
    down: number;
    score: number;
    comments: number;
  }>;
  byCategory: Array<{
    category: SuggestionScope;
    up: number;
    down: number;
    score: number;
  }>;
  bySeverity: Array<{
    severity: string;
    up: number;
    down: number;
    score: number;
  }>;
}

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
  limit: number;
}

export interface ApiError {
  error?: {
    code?: string;
    message?: string;
  };
}
