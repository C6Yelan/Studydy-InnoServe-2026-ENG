"""Delete originals, analysis artifacts, and study records within the material owner's scope."""

from uuid import UUID

from sqlalchemy import delete, func, select

from .material_processing import _request_cancellation_locked
from .storage.analysis_archive import remove_material_analysis
from .storage.artifacts import quarantine_source_pdf, reconcile_discarded_sources
from .storage.tables import (
    AnswerEvent,
    Artifact,
    Assessment,
    AssessmentSet,
    AssessmentSetItem,
    KnowledgeStructure,
    Material,
    MaterialProcessingRun,
    MaterialSource,
    MaterialSourceSet,
    MaterialSourceSetItem,
    SourceNormalization,
    StudySession,
    database_session,
)


class MaterialDiscardError(RuntimeError):
    """Expose fixed reason codes without database or filesystem details."""


def _locked_runs(session, material):
    return session.scalars(
        select(MaterialProcessingRun).where(
            MaterialProcessingRun.learner_id == material.learner_id,
            MaterialProcessingRun.material_id == material.material_id,
        ).order_by(MaterialProcessingRun.run_id).with_for_update()
    ).all()


def request_material_discard(learner_id: UUID, material_id: UUID, *, dsn: str | None = None) -> str:
    try:
        with database_session(dsn) as session:
            material = session.scalar(select(Material).where(
                Material.material_id == material_id,
                Material.learner_id == learner_id,
            ).with_for_update())
            if material is None:
                raise MaterialDiscardError("RESOURCE_NOT_FOUND")
            runs = _locked_runs(session, material)
            if material.discard_requested_at is None:
                material.discard_requested_at = session.scalar(select(func.clock_timestamp()))
            for row in runs:
                _request_cancellation_locked(material, row, session)
            # Inference occurs outside transactions; cancel leases so late results cannot revive deleted material.
            groups = session.scalars(select(AssessmentSet).where(
                AssessmentSet.material_id == material_id,
                AssessmentSet.status.in_(("preparing", "partial_ready", "ready", "in_progress")),
            ).with_for_update()).all()
            for group in groups:
                group.status = "cancelled"
                group.completed_at = func.clock_timestamp()
                group.set_version += 1
                group.lease_token = group.lease_expires_at = None
        # Commit cancellation intent first, then recheck final run states during cleanup.
        return "removed" if purge_discarded_material(learner_id, material_id, dsn=dsn) else "removing"
    except MaterialDiscardError:
        raise
    except Exception:
        raise MaterialDiscardError("MATERIAL_DISCARD_STORAGE_FAILED") from None


def purge_discarded_material(learner_id: UUID, material_id: UUID, *, dsn: str | None = None) -> bool:
    artifact_ids: list[UUID] = []
    try:
        with database_session(dsn) as session:
            material = session.scalar(select(Material).where(
                Material.material_id == material_id,
                Material.learner_id == learner_id,
            ).with_for_update())
            if material is None:
                remove_material_analysis(learner_id, material_id)
                return True
            if material.discard_requested_at is None:
                return False
            runs = _locked_runs(session, material)
            if any(row.status in {"pending", "running"} for row in runs):
                return False
            # Lock parent records before listing children to serialize concurrent study and answer writes.
            session.scalars(select(KnowledgeStructure).where(
                KnowledgeStructure.learner_id == learner_id,
                KnowledgeStructure.material_id == material_id,
            ).order_by(KnowledgeStructure.structure_revision).with_for_update()).all()
            study_ids = session.scalars(select(StudySession.study_session_id).where(
                StudySession.learner_id == learner_id,
                StudySession.material_id == material_id,
            ).order_by(StudySession.study_session_id).with_for_update()).all()
            normalizations = session.scalars(select(SourceNormalization).where(
                SourceNormalization.learner_id == learner_id,
                SourceNormalization.material_id == material_id,
            ).with_for_update()).all()
            now = session.scalar(select(func.clock_timestamp()))
            if any(job.status == "running" and job.lease_expires_at > now for job in normalizations):
                return False
            artifacts = session.scalars(select(Artifact).where(
                Artifact.learner_id == learner_id,
                Artifact.material_id == material_id,
            ).order_by(Artifact.artifact_id).with_for_update()).all()
            for artifact in artifacts:
                artifact_ids.append(artifact.artifact_id)
                quarantine_source_pdf(session, artifact.artifact_id)
            material.head_revision = None
            session.flush()
            session.execute(delete(AnswerEvent).where(
                AnswerEvent.study_session_id.in_(study_ids),
                AnswerEvent.material_id == material_id,
            ))
            session.execute(delete(AssessmentSetItem).where(AssessmentSetItem.study_session_id.in_(study_ids)))
            session.execute(delete(AssessmentSet).where(AssessmentSet.study_session_id.in_(study_ids)))
            session.execute(delete(Assessment).where(Assessment.study_session_id.in_(study_ids)))
            session.execute(delete(StudySession).where(
                StudySession.learner_id == learner_id,
                StudySession.material_id == material_id,
            ))
            session.execute(delete(KnowledgeStructure).where(
                KnowledgeStructure.learner_id == learner_id,
                KnowledgeStructure.material_id == material_id,
            ))
            session.execute(delete(MaterialProcessingRun).where(
                MaterialProcessingRun.learner_id == learner_id,
                MaterialProcessingRun.material_id == material_id,
            ))
            for table in (MaterialSourceSetItem, MaterialSourceSet, SourceNormalization, MaterialSource):
                session.execute(delete(table).where(
                    table.learner_id == learner_id,
                    table.material_id == material_id,
                ))
            session.execute(delete(Artifact).where(
                Artifact.learner_id == learner_id,
                Artifact.material_id == material_id,
            ))
            session.execute(delete(Material).where(
                Material.learner_id == learner_id,
                Material.material_id == material_id,
            ))
        for artifact_id in artifact_ids:
            reconcile_discarded_sources(dsn=dsn, artifact_id=artifact_id)
        remove_material_analysis(learner_id, material_id)
        return True
    except Exception as error:
        # Resolve uncertain commits in a new transaction before restoring or unlinking files.
        for artifact_id in artifact_ids:
            reconcile_discarded_sources(dsn=dsn, artifact_id=artifact_id)
        if isinstance(error, MaterialDiscardError):
            raise
        raise MaterialDiscardError("MATERIAL_DISCARD_STORAGE_FAILED") from None


def finish_material_discards(*, dsn: str | None = None) -> None:
    """Finish saved deletion and quarantine cleanup on startup and worker retries."""
    reconcile_discarded_sources(dsn=dsn)
    with database_session(dsn) as session:
        identities = session.execute(
            select(Material.learner_id, Material.material_id).where(
                Material.discard_requested_at.is_not(None),
            )
        ).all()
    for learner_id, material_id in identities:
        purge_discarded_material(learner_id, material_id, dsn=dsn)
