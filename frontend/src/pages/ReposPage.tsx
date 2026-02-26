import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "../store/app-store";

export function ReposPage() {
  const navigate = useNavigate();
  const {
    session,
    repos,
    repoCursor,
    selectedRepoId,
    busy,
    actions,
    getRepoStatus,
  } = useAppStore();

  const [search, setSearch] = useState("");
  const [privateOnly, setPrivateOnly] = useState(false);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();

    return repos.filter((repo) => {
      if (privateOnly && !repo.private) {
        return false;
      }

      if (!query) {
        return true;
      }

      return (
        repo.fullName.toLowerCase().includes(query) ||
        repo.owner.toLowerCase().includes(query) ||
        repo.name.toLowerCase().includes(query)
      );
    });
  }, [repos, search, privateOnly]);

  if (!session) {
    return (
      <div className="page-wrap">
        <section className="card stack-gap">
          <h1>Сначала подключи GitHub</h1>
          <p className="subline">Для загрузки списка репозиториев нужна активная сессия GitHub.</p>
          <button className="primary-btn" onClick={() => navigate("/connect")}>Открыть подключение</button>
        </section>
      </div>
    );
  }

  return (
    <div className="page-wrap">
      <header className="page-header compact">
        <p className="eyebrow">Шаг 2</p>
        <h1>Репозитории</h1>
        <p className="subline">Выбери репозиторий и открой локальный workflow review только для него.</p>
      </header>

      <section className="card stack-gap">
        <div className="toolbar-row">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Поиск по owner/repo"
          />

          <label className="toggle-line">
            <input type="checkbox" checked={privateOnly} onChange={(event) => setPrivateOnly(event.target.checked)} />
            Только private
          </label>

          <button className="secondary-btn" onClick={() => actions.loadRepos(true)} disabled={busy}>
            Обновить
          </button>
          <button className="secondary-btn" onClick={() => actions.loadRepos(false)} disabled={busy || !repoCursor}>
            Загрузить еще
          </button>
        </div>

        <div className="repo-grid">
          {filtered.map((repo) => {
            const status = getRepoStatus(repo.repoId);
            const active = selectedRepoId === repo.repoId;

            return (
              <article key={repo.repoId} className={`repo-card ${active ? "active" : ""}`}>
                <div className="repo-card-head">
                  <h3>{repo.fullName}</h3>
                  <span className={`status-badge ${status.tone}`}>{status.label}</span>
                </div>
                <p className="repo-meta">default: {repo.defaultBranch}</p>
                <p className="repo-meta">{repo.private ? "private" : "public"}</p>
                <div className="repo-card-actions">
                  <button
                    className="primary-btn"
                    onClick={() => {
                      actions.selectRepo(repo.repoId);
                      navigate(`/repos/${repo.repoId}/workspace`);
                    }}
                  >
                    Открыть workflow
                  </button>
                </div>
              </article>
            );
          })}

          {filtered.length === 0 ? (
            <div className="empty-block">Ничего не найдено. Измени фильтры или обнови список.</div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
