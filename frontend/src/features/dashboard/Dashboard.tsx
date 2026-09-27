import { useEffect, useState } from "react";
import { errorMessage, type StudydyApiClient } from "../../api/client";
import type { MaterialLibraryItem } from "../../api/contracts";
import { writeRoute } from "../../app/routes";
import { Icon, type IconName } from "../../ui/Icon";
import "./styles.css";

const features: { icon: IconName; title: string; description: string }[] = [
  { icon: "map", title: "Build a knowledge map", description: "Analyze your materials into concepts, relationships, and source evidence." },
  {
    icon: "learning",
    title: "Follow a learning path",
    description: "Work through the material in a suggested order, one concept at a time.",
  },
  { icon: "book", title: "Understand concepts", description: "Explore key points and return to the source PDF whenever needed." },
  { icon: "check", title: "Practice and review", description: "Check your understanding with questions and build on saved progress and feedback." },
];

export function Dashboard({ apiClient }: { apiClient: StudydyApiClient }) {
  const [materials, setMaterials] = useState<MaterialLibraryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setError(null);
    void apiClient.listMaterials().then(
      (library) => {
        if (!cancelled) setMaterials(library.materials);
      },
      (failure) => {
        if (!cancelled) setError(errorMessage(failure));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [apiClient, retry]);
  const studies = (materials ?? []).flatMap((material) => {
    const structure =
      material.available_structures.find(
        (value) => value.knowledge_structure_revision === material.head_revision,
      ) ?? material.available_structures[0];
    const state =
      structure &&
      material.study_sessions.find(
        (item) =>
          item.run_id === structure.run_id &&
          item.knowledge_structure_revision === structure.knowledge_structure_revision,
      );
    return state ? [{ material, session: state }] : [];
  });
  const ordered = [...studies].sort(
    (a, b) => Date.parse(b.session.started_at) - Date.parse(a.session.started_at),
  );
  const recent =
    ordered.find((item) => item.session.status === "active" || item.session.status === "no_safe") ??
    ordered.find((item) => item.session.status === "completed");
  const stats: { title: string; value: number | undefined; note: string; icon: IconName }[] = [
    { title: "Material", value: materials?.length, note: "Saved materials", icon: "book" },
    {
      title: "Knowledge map",
      value: materials?.filter((item) => item.available_structures.length > 0).length,
      note: "Materials with a published map",
      icon: "map",
    },
    {
      title: "Study started",
      value: materials ? studies.length : undefined,
      note: "Materials with study progress",
      icon: "learning",
    },
    {
      title: "Completed",
      value: materials
        ? studies.filter((item) => item.session.status === "completed").length
        : undefined,
      note: "Materials with completed study sessions",
      icon: "check",
    },
  ];
  return (
    <section className="dashboard">
      <header className="dashboard-greeting">
        <h1>Welcome back!</h1>
        <p>Pick up where you left off.</p>
      </header>
      <div className="dashboard-content">
        <div className="dashboard-primary">
          <section className="dashboard-hero" aria-label="Build your knowledge map">
            <div className="hero-copy">
              <h2>Build your knowledge map</h2>
              <p>Upload your study materials and let AI organize them into a knowledge map.</p>
              <button
                className="primary-button"
                type="button"
                onClick={() => writeRoute({ name: "upload" })}
              >
                <Icon name="upload" size={18} />
                Upload materials
              </button>
            </div>
            <div className="hero-illustration">
              <div className="hero-document" aria-hidden="true">
                <Icon name="file" size={54} />
                <span />
                <span />
                <span />
              </div>
              <img
                src="/assets/mascot/guide.png"
                alt="Studydy helping you build a knowledge map"
              />
            </div>
          </section>
          {error && (
            <div className="dashboard-error" role="alert">
              <p>{error}</p>
              <button
                className="secondary-button"
                type="button"
                onClick={() => setRetry((value) => value + 1)}
              >
                Refresh
              </button>
            </div>
          )}
          <section className="dashboard-overview" aria-label="Learning overview">
            <h2>Learning overview</h2>
            <div className="dashboard-stats" aria-busy={materials === null && !error}>
              {stats.map((stat, index) => (
                <article className={`dashboard-stat accent-${index}`} key={stat.title}>
                  <span className="stat-icon">
                    <Icon name={stat.icon} size={23} />
                  </span>
                  <span className="stat-copy">
                    <span>{stat.title}</span>
                    <strong>{error ? "—" : (stat.value ?? "—")}</strong>
                    <small>{error ? "Temporarily unavailable" : materials ? stat.note : "Loading…"}</small>
                  </span>
                </article>
              ))}
            </div>
          </section>
          {recent && !error && (
            <section className="dashboard-resume surface">
              <div>
                <h2>Continue studying</h2>
                <p>{recent.material.display_name}</p>
              </div>
              <button
                className="primary-button"
                type="button"
                onClick={() =>
                  writeRoute({
                    name: "study-session",
                    materialId: recent.material.material_id,
                    runId: recent.session.run_id,
                    structureRevision: recent.session.knowledge_structure_revision,
                    studySessionId: recent.session.study_session_id,
                  })
                }
              >
                {recent.session.status === "completed" ? "View study results" : "Continue studying"}
                <Icon name="chevron-right" size={18} />
              </button>
            </section>
          )}
        </div>
        <aside className="dashboard-help surface" aria-label="Studydy learning support">
          <h2>How Studydy supports your learning</h2>
          <div className="dashboard-features">
            {features.map((feature, index) => (
              <article className={`accent-${index}`} key={feature.title}>
                <span className="stat-icon">
                  <Icon name={feature.icon} size={22} />
                </span>
                <div>
                  <h3>{feature.title}</h3>
                  <p>{feature.description}</p>
                </div>
              </article>
            ))}
          </div>
        </aside>
      </div>
    </section>
  );
}
