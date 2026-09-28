"""A single worker exits blocking fakes under real run/lease checks without stale publication."""

from threading import Event
from uuid import uuid4

import pytest

from pdf_evidence import material_pipeline
import runtime.material_processing as processing
import runtime.workers as workers
from runtime.storage.tables import Material, MaterialProcessingRun, database_session
from test_inference_controlled_exit import blocked_http
from test_source_revisions import revisions
from product_fixtures import closed_loop


@pytest.mark.parametrize('intent', ['cancel', 'shutdown', 'lost-token'])
def test_material_worker_exits_blocking_inference_and_fences_publication(revisions, monkeypatch, intent):
    learner, material, settings, dsn, add, start, _, _, old, _ = revisions
    second = add('B.pdf', 'A queue removes the first inserted element first.')
    run = start([second], 'controlled-exit', old['revision'])
    original_analysis = processing.analyze_material
    monkeypatch.setattr(processing, 'analyze_material', material_pipeline.analyze_material)
    monkeypatch.setattr(processing, '_LEASE_HEARTBEAT_SECONDS', .05)
    monkeypatch.setattr(workers, '_SHUTDOWN_WAIT_SECONDS', 2)
    # The fixture normalizes sources itself; prevent the worker from claiming those fixture operations.
    monkeypatch.setattr(workers, 'normalize_next', lambda **_: False)
    completed = Event()
    results = []
    execute = workers.execute_claimed_material_processing_run
    def record(*args, **kwargs):
        result = execute(*args, **kwargs)
        results.append(result)
        completed.set()
        return result
    monkeypatch.setattr(workers, 'execute_claimed_material_processing_run', record)
    with blocked_http(monkeypatch) as server:
        worker = workers.RuntimeWorkers(dsn, settings)
        worker.start()
        try:
            assert server.entered.wait(5)
            if intent == 'shutdown':
                worker.stop()
            elif intent == 'cancel':
                processing.request_material_processing_cancellation(learner.learner_id, run.run_id,
                                                                    update_only=True, dsn=dsn)
            else:
                with database_session(dsn) as session:
                    session.get(MaterialProcessingRun, run.run_id).worker_token = uuid4()
            assert completed.wait(3)
            assert results[0].status == ('cancelled' if intent == 'cancel' else 'running')
            assert results[0].output_binding is None
            with database_session(dsn) as session:
                assert session.get(Material, material).head_revision == old['revision']
            if intent == 'cancel':
                # The same worker handles the next job without restarting.
                monkeypatch.setattr(processing, 'analyze_material', original_analysis)
                third = add('C.pdf', 'A linked list links its nodes with pointers.')
                completed.clear()
                next_run = start([third], 'after-cancel', old['revision'])
                assert completed.wait(5)
                assert results[-1].run_id == next_run.run_id
                assert results[-1].status == 'succeeded'
            worker.stop()
            worker.stop()
            assert not worker._thread.is_alive()
            before = len(results)
            server.release.set()
            assert len(results) == before
        finally:
            server.release.set()
            worker.stop()
