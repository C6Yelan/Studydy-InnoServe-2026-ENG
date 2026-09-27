"""Regression tests use controlled responses and block HTTP access to real model services."""
import httpx
import pytest


@pytest.fixture(autouse=True)
def forbid_live_model_http(monkeypatch):
    # TestClient, ASGITransport, and MockTransport bypass this boundary; real model HTTP is forbidden.
    def reject(*args, **kwargs):
        raise AssertionError("LIVE_MODEL_HTTP_FORBIDDEN_IN_TESTS")

    async def reject_async(*args, **kwargs):
        raise AssertionError("LIVE_MODEL_HTTP_FORBIDDEN_IN_TESTS")

    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", reject)
    monkeypatch.setattr(httpx.AsyncHTTPTransport, "handle_async_request", reject_async)
