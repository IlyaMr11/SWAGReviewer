import type { Hunk, LineMapEntry } from "../../../shared/types/contracts.js";

const HUNK_REGEX = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@(.*)$/;

export function countPatchChanges(patch: string) {
  const lines = patch.split("\n");
  let additions = 0;
  let deletions = 0;

  for (const line of lines) {
    if (line.startsWith("+++ ") || line.startsWith("--- ")) {
      continue;
    }
    if (line.startsWith("+")) {
      additions += 1;
    } else if (line.startsWith("-")) {
      deletions += 1;
    }
  }

  return { additions, deletions };
}

export function parseUnifiedDiff(patch: string): { hunks: Hunk[]; lineMap: LineMapEntry[] } {
  const lines = patch.split("\n");
  const hunks: Hunk[] = [];
  const lineMap: LineMapEntry[] = [];

  let currentOld = 0;
  let currentNew = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const hunkMatch = HUNK_REGEX.exec(line);

    if (hunkMatch) {
      const oldStart = Number(hunkMatch[1]);
      const oldLines = Number(hunkMatch[2] ?? "1");
      const newStart = Number(hunkMatch[3]);
      const newLines = Number(hunkMatch[4] ?? "1");

      hunks.push({
        oldStart,
        oldLines,
        newStart,
        newLines,
        header: hunkMatch[5].trim(),
      });

      currentOld = oldStart;
      currentNew = newStart;
      continue;
    }

    if (line.startsWith("+") && !line.startsWith("+++")) {
      lineMap.push({
        patchLine: i + 1,
        oldLine: null,
        newLine: currentNew,
        type: "add",
      });
      currentNew += 1;
      continue;
    }

    if (line.startsWith("-") && !line.startsWith("---")) {
      lineMap.push({
        patchLine: i + 1,
        oldLine: currentOld,
        newLine: null,
        type: "del",
      });
      currentOld += 1;
      continue;
    }

    if (line.startsWith(" ")) {
      lineMap.push({
        patchLine: i + 1,
        oldLine: currentOld,
        newLine: currentNew,
        type: "ctx",
      });
      currentOld += 1;
      currentNew += 1;
    }
  }

  return { hunks, lineMap };
}

const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
  ts: "TypeScript",
  tsx: "TypeScript",
  js: "JavaScript",
  jsx: "JavaScript",
  py: "Python",
  go: "Go",
  java: "Java",
  cs: "C#",
  rb: "Ruby",
  php: "PHP",
  rs: "Rust",
  cpp: "C++",
  c: "C",
  h: "C/C++",
  swift: "Swift",
  kt: "Kotlin",
  md: "Markdown",
  json: "JSON",
  yml: "YAML",
  yaml: "YAML",
  sql: "SQL",
};

export function detectLanguage(path: string): string {
  const chunks = path.split(".");
  if (chunks.length < 2) {
    return "PlainText";
  }

  const extension = chunks[chunks.length - 1]?.toLowerCase() ?? "";
  return EXTENSION_LANGUAGE_MAP[extension] ?? "PlainText";
}
