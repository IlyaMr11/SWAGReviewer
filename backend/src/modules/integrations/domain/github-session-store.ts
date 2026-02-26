import { randomUUID } from "node:crypto";
import { HttpError } from "../../../shared/errors/http-error.js";

const SESSION_TTL_MS = 60 * 60 * 1000;

export interface GithubSession {
  id: string;
  token: string;
  githubLogin: string;
  createdAt: string;
  expiresAt: string;
}

class GithubSessionStore {
  private readonly sessions = new Map<string, GithubSession>();

  create(token: string, githubLogin: string): GithubSession {
    const now = Date.now();
    const session: GithubSession = {
      id: `ghs_${randomUUID()}`,
      token,
      githubLogin,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
    };

    this.sessions.set(session.id, session);
    this.cleanupExpired();

    return session;
  }

  get(sessionId: string): GithubSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new HttpError(404, "github_session_not_found", `GitHub session not found: ${sessionId}`);
    }

    if (new Date(session.expiresAt).getTime() <= Date.now()) {
      this.sessions.delete(session.id);
      throw new HttpError(401, "github_session_expired", `GitHub session expired: ${sessionId}`);
    }

    return session;
  }

  delete(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  cleanupExpired() {
    const now = Date.now();
    for (const [id, session] of this.sessions.entries()) {
      if (new Date(session.expiresAt).getTime() <= now) {
        this.sessions.delete(id);
      }
    }
  }
}

export const githubSessionStore = new GithubSessionStore();
