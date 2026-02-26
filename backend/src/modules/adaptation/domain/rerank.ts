import type { Suggestion } from "../../../shared/types/contracts.js";

export function rerankSuggestions(
  suggestions: Suggestion[],
  feedbackScoreByFingerprint: Map<string, number>,
): Suggestion[] {
  return [...suggestions].sort((a, b) => {
    const scoreA = feedbackScoreByFingerprint.get(a.fingerprint) ?? 0;
    const scoreB = feedbackScoreByFingerprint.get(b.fingerprint) ?? 0;

    if (scoreA !== scoreB) {
      return scoreB - scoreA;
    }

    if (a.severity !== b.severity) {
      return severityWeight(b.severity) - severityWeight(a.severity);
    }

    return a.createdAt.localeCompare(b.createdAt);
  });
}

function severityWeight(value: Suggestion["severity"]) {
  switch (value) {
    case "critical":
      return 5;
    case "high":
      return 4;
    case "medium":
      return 3;
    case "low":
      return 2;
    case "info":
    default:
      return 1;
  }
}
