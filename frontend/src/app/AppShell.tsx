import { writeRoute, type AppRoute } from "./routes";
import { Icon } from "../ui/Icon";
import "./shell.css";

export function AppShell({
  children,
  route,
  accountAction,
}: {
  children: React.ReactNode;
  route: AppRoute;
  accountAction?: React.ReactNode;
}) {
  const isLearningWorkspace = route.name === "knowledge-map" || route.name === "study-session";
  const isMaterialRoute = ["materials", "material-run", "material-sources", "upload"].includes(
    route.name,
  );
  return (
    <div className={`app-shell ${isLearningWorkspace ? "is-workspace" : "is-standard"}`}>
      <header className="app-header">
        <button
          aria-label="Return to Studydy home"
          className="brand"
          type="button"
          onClick={() => writeRoute({ name: "home" })}
        >
          <img src="/assets/studydy/brand-idle.png" alt="" />
          <span>Studydy{!isLearningWorkspace && <small>AI-powered learning</small>}</span>
        </button>
        {isLearningWorkspace && (
          <nav className="workspace-nav" aria-label="Study workspace navigation">
            {route.name === "study-session" && (
              <button
                type="button"
                onClick={() =>
                  writeRoute({
                    name: "knowledge-map",
                    materialId: route.materialId,
                    runId: route.runId,
                    structureRevision: route.structureRevision,
                  })
                }
              >
                <Icon name="map" size={18} />
                Knowledge map
              </button>
            )}
            <button type="button" onClick={() => writeRoute({ name: "materials" })}>
              <Icon name="book" size={18} />
              My materials
            </button>
          </nav>
        )}
        <div className="account-controls">{accountAction}</div>
      </header>
      {!isLearningWorkspace && (
        <aside className="app-sidebar" aria-label="Study navigation area">
          <nav aria-label="Main navigation">
            <button
              aria-current={route.name === "home" ? "page" : undefined}
              type="button"
              onClick={() => writeRoute({ name: "home" })}
            >
              <Icon name="home" />
              Home
            </button>
            <button
              aria-current={isMaterialRoute ? "page" : undefined}
              aria-label="Library"
              type="button"
              onClick={() => writeRoute({ name: "materials" })}
            >
              <Icon name="book" />
              My materials
            </button>
          </nav>
        </aside>
      )}
      <main className="app-main" id="main-content">
        {children}
      </main>
    </div>
  );
}
