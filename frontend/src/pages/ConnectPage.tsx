import { useNavigate } from "react-router-dom";
import { useAppStore } from "../store/app-store";

export function ConnectPage() {
  const navigate = useNavigate();
  const {
    githubToken,
    session,
    busy,
    actions,
  } = useAppStore();

  async function connect() {
    const ok = await actions.connectGithub();
    if (ok) {
      navigate("/repos");
    }
  }

  return (
    <div className="page-wrap">
      <header className="page-header">
        <p className="eyebrow">Шаг 1</p>
        <h1>Подключение GitHub</h1>
        <p className="subline">Используем только GitHub PAT. После подключения загружаем репозитории и продолжаем workflow.</p>
      </header>

      <section className="card connect-ux-card">
        <div className="connect-ux-top">
          <div className="connect-ux-icon">GH</div>
          <div>
            <p className="status-title">GitHub Token Access</p>
            <p className="status-sub">Минимальные права: <code>repo</code>, <code>read:org</code></p>
          </div>
        </div>

        <label className="field connect-token-field">
          <span>GitHub Personal Access Token (PAT)</span>
          <input
            value={githubToken}
            onChange={(event) => actions.setGithubToken(event.target.value)}
            placeholder="github_pat_..."
            type="password"
          />
        </label>

        <div className="row-actions">
          <button className="primary-btn" onClick={connect} disabled={busy}>
            Подключить GitHub
          </button>
          {session ? (
            <>
              <button
                className="secondary-btn"
                onClick={async () => {
                  await actions.disconnectGithub();
                }}
                disabled={busy}
              >
                Отключить
              </button>
              <button className="secondary-btn" onClick={() => navigate("/repos")}>
                К репозиториям
              </button>
            </>
          ) : null}
        </div>
      </section>

      {session ? (
        <section className="card status-card">
          <div>
            <p className="status-title">GitHub подключен</p>
            <p className="status-sub">Пользователь: {session.githubLogin}</p>
            <p className="status-sub">Сессия активна до: {new Date(session.expiresAt).toLocaleString("ru-RU")}</p>
          </div>
          <button className="primary-btn" onClick={() => navigate("/repos")}>Открыть репозитории</button>
        </section>
      ) : null}
    </div>
  );
}
