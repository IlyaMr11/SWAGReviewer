import { useMemo, useState } from "react";
import { ApiClient } from "./lib/api";
import type {
  AnalysisJob,
  FeedbackSummary,
  GithubPr,
  GithubRepo,
  GithubSession,
  PublishedComment,
  PublishMode,
  Suggestion,
  SuggestionScope,
  SyncResponse,
} from "./types";

const DEFAULT_BACKEND =
  import.meta.env.VITE_BACKEND_BASE_URL ??
  (typeof window !== "undefined" ? window.location.origin : "http://localhost:4000");
const DEFAULT_SERVICE_TOKEN = import.meta.env.VITE_API_SERVICE_TOKEN ?? "";

const ALL_SCOPES: SuggestionScope[] = ["security", "style", "bugs", "performance"];
const SCOPE_LABELS: Record<SuggestionScope, string> = {
  security: "Безопасность",
  style: "Стиль",
  bugs: "Баги",
  performance: "Производительность",
};

const JOB_STATUS_LABELS: Record<AnalysisJob["status"], string> = {
  queued: "в очереди",
  running: "выполняется",
  done: "завершена",
  failed: "ошибка",
  canceled: "отменена",
};

const SEVERITY_LABELS: Record<Suggestion["severity"], string> = {
  info: "info",
  low: "низкий",
  medium: "средний",
  high: "высокий",
  critical: "критичный",
};

interface ActivityLog {
  id: string;
  at: string;
  text: string;
}

export default function App() {
  const [backendUrl, setBackendUrl] = useState(DEFAULT_BACKEND);
  const [serviceToken, setServiceToken] = useState(DEFAULT_SERVICE_TOKEN);
  const [githubToken, setGithubToken] = useState("");
  const [session, setSession] = useState<GithubSession | null>(null);

  const [repos, setRepos] = useState<GithubRepo[]>([]);
  const [repoCursor, setRepoCursor] = useState<string | null>(null);
  const [selectedRepo, setSelectedRepo] = useState<GithubRepo | null>(null);

  const [prState, setPrState] = useState<"open" | "closed" | "all">("open");
  const [prs, setPrs] = useState<GithubPr[]>([]);
  const [selectedPrNumber, setSelectedPrNumber] = useState<number | null>(null);

  const [syncData, setSyncData] = useState<SyncResponse | null>(null);

  const [scope, setScope] = useState<Record<SuggestionScope, boolean>>({
    security: true,
    style: true,
    bugs: true,
    performance: false,
  });
  const [maxComments, setMaxComments] = useState(30);

  const [job, setJob] = useState<AnalysisJob | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);

  const [publishMode, setPublishMode] = useState<PublishMode>("review_comments");
  const [dryRun, setDryRun] = useState(true);
  const [comments, setComments] = useState<PublishedComment[]>([]);
  const [feedbackSummary, setFeedbackSummary] = useState<FeedbackSummary | null>(null);

  const [feedbackUserId, setFeedbackUserId] = useState("dev_local");
  const [feedbackReason, setFeedbackReason] = useState("полезно");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activity, setActivity] = useState<ActivityLog[]>([]);

  const api = useMemo(
    () =>
      new ApiClient({
        baseUrl: backendUrl,
        serviceToken: serviceToken.trim().length > 0 ? serviceToken.trim() : undefined,
      }),
    [backendUrl, serviceToken],
  );

  const selectedPr = useMemo(
    () => prs.find((item) => item.number === selectedPrNumber) ?? null,
    [prs, selectedPrNumber],
  );

  function pushActivity(text: string) {
    setActivity((prev) => [
      {
        id: crypto.randomUUID(),
        at: new Date().toLocaleTimeString("ru-RU"),
        text,
      },
      ...prev,
    ].slice(0, 18));
  }

  async function runStep<T>(text: string, task: () => Promise<T>) {
    setBusy(true);
    setError(null);
    try {
      const result = await task();
      pushActivity(text);
      return result;
    } catch (err) {
      const message = formatUiError(err, backendUrl);
      setError(message);
      pushActivity(`Ошибка: ${message}`);
      throw err;
    } finally {
      setBusy(false);
    }
  }

  async function connectGithub() {
    if (!githubToken.trim()) {
      setError("Требуется GitHub токен");
      return;
    }

    const nextSession = await runStep("GitHub сессия создана", () => api.createGithubSession(githubToken.trim()));
    setSession(nextSession);
    await loadRepos(nextSession.sessionId, true);
  }

  async function disconnectGithub() {
    if (!session) {
      return;
    }

    await runStep("GitHub сессия удалена", () => api.deleteGithubSession(session.sessionId));
    setSession(null);
    setRepos([]);
    setRepoCursor(null);
    setSelectedRepo(null);
    setPrs([]);
    setSelectedPrNumber(null);
    setSyncData(null);
    setJob(null);
    setSuggestions([]);
    setComments([]);
    setFeedbackSummary(null);
  }

  async function loadRepos(sessionId = session?.sessionId, reset = false) {
    if (!sessionId) {
      setError("Нет активной GitHub сессии");
      return;
    }

    const cursor = reset ? null : repoCursor;
    const page = await runStep("Репозитории загружены", () => api.getGithubRepos(sessionId, cursor));

    if (reset) {
      setRepos(page.items);
      setSelectedRepo(page.items[0] ?? null);
    } else {
      setRepos((prev) => [...prev, ...page.items]);
    }

    setRepoCursor(page.nextCursor);
  }

  async function loadPullRequests() {
    if (!session || !selectedRepo) {
      setError("Сначала выберите GitHub сессию и репозиторий");
      return;
    }

    const response = await runStep(
      `PR загружены (${selectedRepo.fullName})`,
      () => api.getGithubPrs(session.sessionId, selectedRepo.owner, selectedRepo.name, prState),
    );

    setPrs(response.items);
    setSelectedPrNumber(response.items[0]?.number ?? null);
  }

  async function syncSelectedPullRequest() {
    if (!session || !selectedRepo || !selectedPr) {
      setError("Сначала выберите репозиторий и PR");
      return;
    }

    const response = await runStep(
      `PR синхронизирован (${selectedRepo.fullName}#${selectedPr.number})`,
      () => api.syncGithubPr(session.sessionId, selectedRepo.owner, selectedRepo.name, selectedPr.number),
    );

    setSyncData(response);
    setJob(null);
    setSuggestions([]);
    setComments([]);
    setFeedbackSummary(null);
  }

  async function createAnalysisJob() {
    if (!syncData) {
      setError("Сначала выполните синхронизацию PR");
      return;
    }

    const scopeValues = ALL_SCOPES.filter((key) => scope[key]);
    if (scopeValues.length === 0) {
      setError("Выберите хотя бы одну область анализа");
      return;
    }

    const created = await runStep("Задача анализа создана", () =>
      api.createAnalysisJob(syncData.prId, {
        snapshotId: syncData.snapshotId,
        scope: scopeValues,
        maxComments,
      }),
    );

    const fullJob = await runStep("Статус задачи анализа обновлён", () => api.getAnalysisJob(created.jobId));
    setJob(fullJob);
    await loadSuggestions(fullJob.id);
  }

  async function refreshJob() {
    if (!job) {
      return;
    }

    const fresh = await runStep("Задача анализа обновлена", () => api.getAnalysisJob(job.id));
    setJob(fresh);
  }

  async function loadSuggestions(jobId = job?.id) {
    if (!jobId) {
      setError("Задача анализа не выбрана");
      return;
    }

    let cursor: string | null = null;
    const all: Suggestion[] = [];

    do {
      const page = await api.getAnalysisResults(jobId, cursor);
      all.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor);

    setSuggestions(all);
    pushActivity(`Загружено рекомендаций: ${all.length}`);
  }

  async function publishSuggestions() {
    if (!syncData || !job) {
      setError("Сначала выполните sync PR и запустите анализ");
      return;
    }

    const publish = await runStep(
      `Публикация запрошена (dryRun=${String(dryRun)})`,
      () => api.publishSuggestions(syncData.prId, { jobId: job.id, mode: publishMode, dryRun }),
    );

    setComments(publish.comments);

    if (!dryRun) {
      await loadComments(syncData.prId);
      await loadFeedbackSummary(syncData.prId);
    }
  }

  async function loadComments(prId = syncData?.prId) {
    if (!prId) {
      setError("Нет синхронизированного PR");
      return;
    }

    let cursor: string | null = null;
    const all: PublishedComment[] = [];

    do {
      const page = await api.getPrComments(prId, cursor);
      all.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor);

    setComments(all);
    pushActivity(`Загружено комментариев: ${all.length}`);
  }

  async function voteComment(commentId: string, vote: "up" | "down") {
    if (!feedbackUserId.trim()) {
      setError("Укажите ID пользователя для голосования");
      return;
    }

    await runStep(`Голос отправлен (${vote === "up" ? "полезно" : "неполезно"})`, () =>
      api.putFeedback(commentId, {
        userId: feedbackUserId.trim(),
        vote,
        reason: feedbackReason.trim() || undefined,
      }),
    );

    if (syncData?.prId) {
      await loadFeedbackSummary(syncData.prId);
    }
  }

  async function loadFeedbackSummary(prId = syncData?.prId) {
    if (!prId) {
      setError("Нет синхронизированного PR");
      return;
    }

    const summary = await runStep("Сводка фидбека обновлена", () => api.getFeedbackSummary(prId));
    setFeedbackSummary(summary);
  }

  return (
    <div className="app-shell">
      <header className="hero reveal">
        <div>
          <p className="eyebrow">SWAGReviewer</p>
          <h1>Центр Управления AI-Ревью</h1>
          <p className="subtle">Подключите GitHub, загрузите PR, запустите анализ, опубликуйте комментарии и соберите фидбек в одном потоке.</p>
        </div>
        <div className="status-pills">
          <span className={`pill ${session ? "ok" : "warn"}`}>{session ? `Сессия: ${session.githubLogin}` : "Сессия: не подключена"}</span>
          <span className={`pill ${syncData ? "ok" : "warn"}`}>{syncData ? `PR: ${syncData.prId}` : "PR: не синхронизирован"}</span>
          <span className={`pill ${job?.status === "done" ? "ok" : "warn"}`}>
            {job ? `Задача: ${JOB_STATUS_LABELS[job.status]}` : "Задача: не запущена"}
          </span>
        </div>
      </header>

      {error ? <div className="error-banner reveal">{error}</div> : null}

      <main className="grid">
        <section className="panel reveal">
          <h2>1. Подключение</h2>
          <label>
            URL backend
            <input value={backendUrl} onChange={(event) => setBackendUrl(event.target.value)} placeholder="http://localhost:4000" />
          </label>
          <label>
            API Service Token (опционально)
            <input value={serviceToken} onChange={(event) => setServiceToken(event.target.value)} placeholder="Значение Bearer токена" />
          </label>
          <label>
            GitHub Token (PAT)
            <input value={githubToken} onChange={(event) => setGithubToken(event.target.value)} placeholder="github_pat_..." type="password" />
          </label>
          <div className="row">
            <button onClick={connectGithub} disabled={busy}>Подключить GitHub</button>
            <button className="ghost" onClick={disconnectGithub} disabled={busy || !session}>Отключить</button>
          </div>
          {session ? <p className="subtle">Сессия действует до: {new Date(session.expiresAt).toLocaleString("ru-RU")}</p> : null}
        </section>

        <section className="panel reveal">
          <h2>2. Репозиторий и PR</h2>
          <div className="row">
            <button onClick={() => loadRepos(undefined, true)} disabled={busy || !session}>Обновить репозитории</button>
            <button className="ghost" onClick={() => loadRepos()} disabled={busy || !session || !repoCursor}>Загрузить ещё</button>
          </div>

          <label>
            Репозиторий
            <select
              value={selectedRepo?.fullName ?? ""}
              onChange={(event) => {
                const next = repos.find((repo) => repo.fullName === event.target.value) ?? null;
                setSelectedRepo(next);
                setPrs([]);
                setSelectedPrNumber(null);
              }}
            >
              <option value="">Выберите репозиторий</option>
              {repos.map((repo) => (
                <option key={repo.repoId} value={repo.fullName}>
                  {repo.fullName}{repo.private ? " (private)" : ""}
                </option>
              ))}
            </select>
          </label>

          <div className="row">
            <label className="compact">
              Состояние PR
              <select value={prState} onChange={(event) => setPrState(event.target.value as "open" | "closed" | "all")}> 
                <option value="open">Открытые</option>
                <option value="closed">Закрытые</option>
                <option value="all">Все</option>
              </select>
            </label>
            <button onClick={loadPullRequests} disabled={busy || !selectedRepo}>Загрузить PR</button>
          </div>

          <label>
            Запрос на слияние (PR)
            <select
              value={selectedPrNumber ?? ""}
              onChange={(event) => setSelectedPrNumber(event.target.value ? Number(event.target.value) : null)}
            >
              <option value="">Выберите PR</option>
              {prs.map((pr) => (
                <option key={pr.number} value={pr.number}>
                  #{pr.number} {pr.title}
                </option>
              ))}
            </select>
          </label>

          <button onClick={syncSelectedPullRequest} disabled={busy || !selectedPr}>Синхронизировать выбранный PR</button>
          {syncData ? (
            <p className="subtle">Снимок {syncData.snapshotId} | файлов {syncData.counts.files} | добавлено {syncData.counts.additions}</p>
          ) : null}
        </section>

        <section className="panel reveal">
          <h2>3. Задача Анализа</h2>
          <div className="chips">
            {ALL_SCOPES.map((item) => (
              <button
                key={item}
                className={scope[item] ? "chip active" : "chip"}
                onClick={() => setScope((prev) => ({ ...prev, [item]: !prev[item] }))}
                disabled={busy}
              >
                {SCOPE_LABELS[item]}
              </button>
            ))}
          </div>

          <label>
            Максимум комментариев
            <input
              type="number"
              min={1}
              max={500}
              value={maxComments}
              onChange={(event) => setMaxComments(Number(event.target.value || 1))}
            />
          </label>

          <div className="row">
            <button onClick={createAnalysisJob} disabled={busy || !syncData}>Запустить анализ</button>
            <button className="ghost" onClick={refreshJob} disabled={busy || !job}>Обновить задачу</button>
            <button className="ghost" onClick={() => loadSuggestions()} disabled={busy || !job}>Обновить результаты</button>
          </div>

          {job ? (
            <div className="kv">
              <p>Статус: <strong>{JOB_STATUS_LABELS[job.status]}</strong></p>
              <p>Прогресс: <strong>{job.progress.filesDone}/{job.progress.total}</strong></p>
              <p>Рекомендаций: <strong>{job.summary.totalSuggestions}</strong></p>
              <p>Частичных ошибок: <strong>{job.summary.partialFailures}</strong></p>
            </div>
          ) : null}
        </section>

        <section className="panel reveal wide">
          <h2>4. Рекомендации</h2>
          <p className="subtle">Всего: {suggestions.length}</p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Серьёзность</th>
                  <th>Категория</th>
                  <th>Файл</th>
                  <th>Заголовок</th>
                  <th>Источник</th>
                </tr>
              </thead>
              <tbody>
                {suggestions.map((item) => (
                  <tr key={item.id}>
                    <td><span className={`severity ${item.severity}`}>{SEVERITY_LABELS[item.severity]}</span></td>
                    <td>{SCOPE_LABELS[item.category]}</td>
                    <td>{item.filePath}:{item.lineStart}</td>
                    <td>
                      <strong>{item.title}</strong>
                      <p>{item.body}</p>
                    </td>
                    <td>
                      {item.citations[0] ? (
                        <a href={item.citations[0].url} target="_blank" rel="noreferrer">
                          {item.citations[0].title}
                        </a>
                      ) : "-"}
                    </td>
                  </tr>
                ))}
                {suggestions.length === 0 ? (
                  <tr>
                    <td colSpan={5}><em>Пока нет рекомендаций</em></td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel reveal">
          <h2>5. Публикация</h2>
          <label>
            Режим
            <select value={publishMode} onChange={(event) => setPublishMode(event.target.value as PublishMode)}>
              <option value="review_comments">review_comments (ревью-комментарии)</option>
              <option value="issue_comments">issue_comments (issue-комментарии)</option>
            </select>
          </label>

          <label className="checkbox">
            <input type="checkbox" checked={dryRun} onChange={(event) => setDryRun(event.target.checked)} />
            Тестовый режим (без отправки в GitHub)
          </label>

          <div className="row">
            <button onClick={publishSuggestions} disabled={busy || !job || !syncData}>Опубликовать</button>
            <button className="ghost" onClick={() => loadComments()} disabled={busy || !syncData}>Обновить комментарии</button>
          </div>

          <p className="subtle">Загружено комментариев: {comments.length}</p>
        </section>

        <section className="panel reveal">
          <h2>6. Фидбек</h2>
          <label>
            ID пользователя
            <input value={feedbackUserId} onChange={(event) => setFeedbackUserId(event.target.value)} />
          </label>

          <label>
            Причина
            <input value={feedbackReason} onChange={(event) => setFeedbackReason(event.target.value)} />
          </label>

          <div className="feedback-list">
            {comments.slice(0, 6).map((comment) => (
              <div key={comment.id} className="feedback-item">
                <p>{comment.filePath}:{comment.lineStart}</p>
                <div className="row">
                  <button className="tiny" onClick={() => voteComment(comment.id, "up")} disabled={busy}>Полезно</button>
                  <button className="tiny danger" onClick={() => voteComment(comment.id, "down")} disabled={busy}>Неполезно</button>
                </div>
              </div>
            ))}
            {comments.length === 0 ? <p className="subtle">Нет опубликованных комментариев для голосования.</p> : null}
          </div>
        </section>

        <section className="panel reveal wide">
          <h2>7. Аналитика</h2>
          <div className="row">
            <button onClick={() => loadFeedbackSummary()} disabled={busy || !syncData}>Обновить сводку</button>
          </div>

          {feedbackSummary ? (
            <div className="analytics-grid">
              <article>
                <h3>Итог</h3>
                <p>Полезно: {feedbackSummary.overall.up}</p>
                <p>Неполезно: {feedbackSummary.overall.down}</p>
                <p>Счёт: {feedbackSummary.overall.score}</p>
              </article>
              <article>
                <h3>По категориям</h3>
                {feedbackSummary.byCategory.map((item) => (
                  <p key={item.category}>{SCOPE_LABELS[item.category]}: {item.score}</p>
                ))}
                {feedbackSummary.byCategory.length === 0 ? <p>-</p> : null}
              </article>
              <article>
                <h3>По серьёзности</h3>
                {feedbackSummary.bySeverity.map((item) => (
                  <p key={item.severity}>{item.severity}: {item.score}</p>
                ))}
                {feedbackSummary.bySeverity.length === 0 ? <p>-</p> : null}
              </article>
            </div>
          ) : (
            <p className="subtle">Сводка появится после голосования.</p>
          )}
        </section>

        <section className="panel reveal wide">
          <h2>Лог Действий</h2>
          <ul className="log-list">
            {activity.map((item) => (
              <li key={item.id}>
                <span>{item.at}</span>
                <p>{item.text}</p>
              </li>
            ))}
            {activity.length === 0 ? <li><p>Пока нет действий.</p></li> : null}
          </ul>
        </section>
      </main>
    </div>
  );
}

function formatUiError(error: unknown, backendUrl: string): string {
  const message = error instanceof Error ? error.message : "Неизвестная ошибка";

  if (message === "Failed to fetch" || message === "Load failed" || message.includes("NetworkError")) {
    return `Не удалось подключиться к серверу backend (${backendUrl}). Проверьте, что backend запущен и доступен из браузера.`;
  }

  if (message.includes("Unauthorized") || message.includes("Invalid or missing service token")) {
    return "Ошибка авторизации backend: проверьте API Service Token.";
  }

  return message;
}
