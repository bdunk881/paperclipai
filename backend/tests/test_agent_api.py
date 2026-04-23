"""
Contract tests for the staging FastAPI agent-management routes.
"""

from fastapi.testclient import TestClient

from agents import agent_store
from main import app


client = TestClient(app)
AUTH_HEADERS = {"X-User-Id": "test-user"}
MUTATION_HEADERS = {"X-User-Id": "test-user", "X-Paperclip-Run-Id": "run-test-1"}


def setup_function() -> None:
    agent_store.clear()


def create_agent(name: str = "Revenue Copilot", budget_monthly_usd: float = 120.0) -> dict:
    response = client.post(
        "/api/agents",
        headers=MUTATION_HEADERS,
        json={
            "name": name,
            "description": "Tracks and coordinates pipeline follow-up",
            "roleKey": "revenue-ops",
            "instructions": "Process routine revenue tasks",
            "budgetMonthlyUsd": budget_monthly_usd,
        },
    )
    assert response.status_code == 201
    return response.json()


def test_agent_crud_requires_run_header_for_mutations() -> None:
    response = client.post("/api/agents", headers=AUTH_HEADERS, json={"name": "No Run Header"})
    assert response.status_code == 400
    assert "X-Paperclip-Run-Id" in response.json()["detail"]


def test_agent_crud_and_listing_are_user_scoped() -> None:
    created = create_agent()

    list_res = client.get("/api/agents", headers=AUTH_HEADERS)
    assert list_res.status_code == 200
    assert list_res.json()["total"] == 1
    assert list_res.json()["agents"][0]["id"] == created["id"]

    get_res = client.get(f"/api/agents/{created['id']}", headers=AUTH_HEADERS)
    assert get_res.status_code == 200
    assert get_res.json()["roleKey"] == "revenue-ops"

    patch_res = client.patch(
        f"/api/agents/{created['id']}",
        headers={"X-User-Id": "test-user", "X-Paperclip-Run-Id": "run-test-2"},
        json={"status": "running", "budgetMonthlyUsd": 150},
    )
    assert patch_res.status_code == 200
    assert patch_res.json()["status"] == "running"
    assert patch_res.json()["budgetMonthlyUsd"] == 150

    other_user_res = client.get(f"/api/agents/{created['id']}", headers={"X-User-Id": "other-user"})
    assert other_user_res.status_code == 404

    delete_res = client.delete(
        f"/api/agents/{created['id']}",
        headers={"X-User-Id": "test-user", "X-Paperclip-Run-Id": "run-test-3"},
    )
    assert delete_res.status_code == 204
    assert client.get("/api/agents", headers=AUTH_HEADERS).json()["total"] == 0


def test_heartbeat_runs_budget_and_token_usage_flow() -> None:
    agent = create_agent(budget_monthly_usd=10)

    heartbeat_res = client.post(
        f"/api/agents/{agent['id']}/heartbeat",
        headers={"X-User-Id": "test-user", "X-Paperclip-Run-Id": "run-heartbeat"},
        json={
            "status": "running",
            "summary": "Heartbeat after queue sweep",
            "tokenUsage": 42,
            "costUsd": 0.25,
        },
    )
    assert heartbeat_res.status_code == 201
    assert heartbeat_res.json()["status"] == "running"

    latest_heartbeat_res = client.get(f"/api/agents/{agent['id']}/heartbeat", headers=AUTH_HEADERS)
    assert latest_heartbeat_res.status_code == 200
    assert latest_heartbeat_res.json()["summary"] == "Heartbeat after queue sweep"

    run_res = client.post(
        f"/api/agents/{agent['id']}/runs",
        headers={"X-User-Id": "test-user", "X-Paperclip-Run-Id": "run-execution"},
        json={
            "runId": "exec-1",
            "status": "completed",
            "summary": "Processed the morning pipeline queue",
            "tokenUsage": 950,
            "costUsd": 12.5,
        },
    )
    assert run_res.status_code == 201
    assert run_res.json()["runId"] == "exec-1"

    runs_res = client.get(f"/api/agents/{agent['id']}/runs", headers=AUTH_HEADERS)
    assert runs_res.status_code == 200
    assert runs_res.json()["total"] == 1
    assert runs_res.json()["runs"][0]["tokenUsage"] == 950

    budget_res = client.get(f"/api/agents/{agent['id']}/budget", headers=AUTH_HEADERS)
    assert budget_res.status_code == 200
    assert budget_res.json()["monthlyUsd"] == 10
    assert budget_res.json()["spentUsd"] == 12.5
    assert budget_res.json()["autoPaused"] is True

    token_usage_res = client.get(f"/api/agents/{agent['id']}/token-usage?days=7", headers=AUTH_HEADERS)
    assert token_usage_res.status_code == 200
    assert token_usage_res.json()["totalTokens"] == 950
    assert token_usage_res.json()["daily"][0]["tokens"] == 950

    paused_agent = client.get(f"/api/agents/{agent['id']}", headers=AUTH_HEADERS)
    assert paused_agent.status_code == 200
    assert paused_agent.json()["status"] == "paused"


def test_budget_updates_and_routines_can_be_managed() -> None:
    agent = create_agent(name="Ops Coordinator", budget_monthly_usd=0)

    budget_res = client.post(
        f"/api/agents/{agent['id']}/budget",
        headers={"X-User-Id": "test-user", "X-Paperclip-Run-Id": "run-budget"},
        json={"monthlyUsd": 75, "note": "Initial monthly allocation"},
    )
    assert budget_res.status_code == 200
    assert budget_res.json()["monthlyUsd"] == 75
    assert budget_res.json()["remainingUsd"] == 75

    routine_res = client.post(
        "/api/routines",
        headers={"X-User-Id": "test-user", "X-Paperclip-Run-Id": "run-routine"},
        json={
            "agentId": agent["id"],
            "name": "Weekly pipeline audit",
            "scheduleType": "interval",
            "intervalMinutes": 60,
            "prompt": "Audit active opportunities and flag stale deals.",
        },
    )
    assert routine_res.status_code == 201
    routine = routine_res.json()
    assert routine["agentId"] == agent["id"]
    assert routine["status"] == "active"

    list_res = client.get(f"/api/routines?agent_id={agent['id']}", headers=AUTH_HEADERS)
    assert list_res.status_code == 200
    assert list_res.json()["total"] == 1

    patch_res = client.patch(
        f"/api/routines/{routine['id']}",
        headers={"X-User-Id": "test-user", "X-Paperclip-Run-Id": "run-routine-patch"},
        json={"status": "paused", "scheduleType": "cron", "cronExpression": "0 9 * * 1"},
    )
    assert patch_res.status_code == 200
    assert patch_res.json()["status"] == "paused"
    assert patch_res.json()["scheduleType"] == "cron"
    assert patch_res.json()["cronExpression"] == "0 9 * * 1"
