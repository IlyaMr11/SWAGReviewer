import type {
  Citation,
  LineMapEntry,
  Severity,
  SnapshotFile,
  SuggestionCategory,
} from "../../../shared/types/contracts.js";

export interface RagAnalyzeRequest {
  jobId: string;
  snapshotId: string;
  scope: SuggestionCategory[];
  files: Array<{
    path: string;
    language: string;
    patch: string;
    hunks?: SnapshotFile["hunks"];
    lineMap?: LineMapEntry[];
  }>;
  limits: {
    maxComments: number;
    maxPerFile: number;
  };
}

export interface RagAnalyzeSuggestion {
  filePath: string;
  lineStart: number;
  lineEnd: number;
  severity: Severity;
  category: SuggestionCategory;
  title: string;
  body: string;
  citations: Citation[];
  confidence: number;
  fingerprint?: string;
}

export interface RagAnalyzeResponse {
  suggestions: RagAnalyzeSuggestion[];
  partialFailures: number;
}

const DEFAULT_CITATIONS: Record<SuggestionCategory, Citation> = {
  security: {
    sourceId: "owasp-top-10",
    title: "OWASP Top 10",
    url: "https://owasp.org/www-project-top-ten/",
    snippet: "Validate all untrusted input and use context-aware output encoding.",
  },
  style: {
    sourceId: "clean-code",
    title: "Clean Code Principles",
    url: "https://martinfowler.com/bliki/CodeSmell.html",
    snippet: "Prefer clear naming and small focused functions.",
  },
  bugs: {
    sourceId: "github-engineering",
    title: "GitHub Engineering Practices",
    url: "https://github.blog/engineering/",
    snippet: "Cover edge cases and fail fast with actionable errors.",
  },
  performance: {
    sourceId: "web-dev-performance",
    title: "Web Performance Fundamentals",
    url: "https://web.dev/fast/",
    snippet: "Avoid unnecessary work in hot paths and use bounded loops.",
  },
};

export async function analyzeWithRag(request: RagAnalyzeRequest): Promise<RagAnalyzeResponse> {
  const suggestions: RagAnalyzeSuggestion[] = [];
  const scope: SuggestionCategory[] = request.scope.length > 0 ? request.scope : ["bugs"];

  for (const [index, file] of request.files.entries()) {
    if (suggestions.length >= request.limits.maxComments) {
      break;
    }

    if (!file.patch || file.patch.trim().length === 0) {
      continue;
    }

    const firstAddedLine = file.lineMap?.find((entry) => entry.type === "add")?.newLine ?? 1;
    const category: SuggestionCategory = scope[index % scope.length];

    suggestions.push({
      filePath: file.path,
      lineStart: firstAddedLine,
      lineEnd: firstAddedLine,
      severity: chooseSeverity(category),
      category,
      title: `Potential ${category} issue in ${file.path}`,
      body: `Check this change for ${category} risks and ensure it follows team standards.`,
      citations: [DEFAULT_CITATIONS[category]],
      confidence: 0.72,
    });
  }

  return {
    suggestions,
    partialFailures: 0,
  };
}

function chooseSeverity(category: SuggestionCategory): Severity {
  switch (category) {
    case "security":
      return "high";
    case "performance":
      return "medium";
    case "style":
      return "low";
    case "bugs":
    default:
      return "medium";
  }
}
