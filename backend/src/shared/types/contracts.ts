export type JobStatus = "queued" | "running" | "done" | "failed" | "canceled";
export type Severity = "info" | "low" | "medium" | "high" | "critical";
export type SuggestionCategory = "security" | "style" | "bugs" | "performance";
export type PublishMode = "review_comments" | "issue_comments";
export type CommentState = "pending" | "posted" | "failed";
export type FeedbackVoteValue = "up" | "down";
export type FileStatus = "added" | "modified" | "removed" | "renamed";

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface GithubInstallation {
  id: string;
  installationId: number;
  accountLogin: string;
  createdAt: string;
  updatedAt: string;
}

export interface Repository {
  id: string;
  provider: "github";
  installationId: string;
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  createdAt: string;
  updatedAt: string;
}

export interface PullRequest {
  id: string;
  repoId: string;
  number: number;
  title: string;
  state: "open" | "closed" | "merged";
  authorLogin: string;
  url: string;
  baseSha: string;
  headSha: string;
  latestSnapshotId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  header: string;
}

export interface LineMapEntry {
  patchLine: number;
  oldLine: number | null;
  newLine: number | null;
  type: "add" | "del" | "ctx";
}

export interface SnapshotFile {
  id: string;
  snapshotId: string;
  path: string;
  status: FileStatus;
  language: string;
  additions: number;
  deletions: number;
  patch: string;
  hunks?: Hunk[];
  lineMap?: LineMapEntry[];
  patchHash: string;
  isTooLarge: boolean;
  createdAt: string;
}

export interface PRSnapshot {
  id: string;
  prId: string;
  commitSha: string;
  baseSha: string;
  headSha: string;
  filesCount: number;
  additions: number;
  deletions: number;
  createdAt: string;
}

export interface AnalysisJob {
  id: string;
  prId: string;
  snapshotId: string;
  status: JobStatus;
  scope: SuggestionCategory[];
  filesFilter: string[] | null;
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
  createdAt: string;
  updatedAt: string;
}

export interface Citation {
  sourceId: string;
  title: string;
  url: string;
  snippet: string;
}

export interface Suggestion {
  id: string;
  jobId: string;
  prId: string;
  snapshotId: string;
  fingerprint: string;
  filePath: string;
  lineStart: number;
  lineEnd: number;
  severity: Severity;
  category: SuggestionCategory;
  title: string;
  body: string;
  citations: Citation[];
  confidence: number;
  createdAt: string;
}

export interface PublishedComment {
  id: string;
  prId: string;
  jobId: string;
  suggestionId: string;
  providerCommentId: string | null;
  mode: PublishMode;
  state: CommentState;
  filePath: string;
  lineStart: number;
  lineEnd: number;
  body: string;
  createdAt: string;
}

export interface FeedbackVote {
  id: string;
  commentId: string;
  userId: string;
  vote: FeedbackVoteValue;
  reason: string | null;
  updatedAt: string;
  createdAt: string;
}

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
  limit: number;
}

export interface SyncFileInput {
  path: string;
  status?: FileStatus;
  language?: string;
  patch: string;
  additions?: number;
  deletions?: number;
}

export interface SyncPrInput {
  title?: string;
  state?: "open" | "closed" | "merged";
  authorLogin?: string;
  url?: string;
  baseSha?: string;
  headSha?: string;
  commitSha?: string;
  files?: SyncFileInput[];
}

export interface AnalysisJobInput {
  snapshotId: string;
  scope: SuggestionCategory[];
  files?: string[];
  maxComments: number;
}
