import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { ConnectPage } from "./pages/ConnectPage";
import { RepoWorkspacePage } from "./pages/RepoWorkspacePage";
import { ReposPage } from "./pages/ReposPage";
import { useAppStore } from "./store/app-store";

export default function App() {
  const { session, error, actions, activity } = useAppStore();

  return (
    <>
      {error ? (
        <div className="top-error">
          <span>{error}</span>
          <button onClick={actions.clearError}>Закрыть</button>
        </div>
      ) : null}

      <Routes>
        <Route path="/" element={<Navigate to={session ? "/repos" : "/connect"} replace />} />
        <Route element={<AppShell />}>
          <Route path="/connect" element={<ConnectPage />} />
          <Route path="/repos" element={<ReposPage />} />
          <Route path="/repos/:repoId/workspace" element={<RepoWorkspacePage />} />
        </Route>
        <Route path="*" element={<Navigate to={session ? "/repos" : "/connect"} replace />} />
      </Routes>

      <div className="activity-dock">
        <p>Лог действий</p>
        <ul>
          {activity.slice(0, 5).map((item) => (
            <li key={item.id}>
              <span>{item.at}</span>
              <span>{item.text}</span>
            </li>
          ))}
          {activity.length === 0 ? <li><span>—</span><span>Пока пусто</span></li> : null}
        </ul>
      </div>
    </>
  );
}
