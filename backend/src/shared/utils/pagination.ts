const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export function parseLimit(raw: unknown): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_LIMIT;
  }
  return Math.min(Math.floor(parsed), MAX_LIMIT);
}

export function decodeCursor(raw: unknown): number {
  if (typeof raw !== "string" || raw.length === 0) {
    return 0;
  }

  try {
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    const index = Number(decoded);
    if (!Number.isFinite(index) || index < 0) {
      return 0;
    }
    return Math.floor(index);
  } catch {
    return 0;
  }
}

export function encodeCursor(index: number | null): string | null {
  if (index === null || index < 0) {
    return null;
  }
  return Buffer.from(String(index), "utf8").toString("base64url");
}

export function paginate<T>(items: T[], cursor: unknown, limitRaw: unknown) {
  const start = decodeCursor(cursor);
  const limit = parseLimit(limitRaw);
  const pageItems = items.slice(start, start + limit);
  const nextIndex = start + pageItems.length;
  const hasMore = nextIndex < items.length;

  return {
    items: pageItems,
    nextCursor: hasMore ? encodeCursor(nextIndex) : null,
    limit,
  };
}
