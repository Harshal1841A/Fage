import os
import sys
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app.main import app

client = TestClient(app)
VALID_HEADERS = {"X-API-Key": "fage-demo-key-2026"}


def test_public_endpoints():
    response_index = client.get("/")
    assert response_index.status_code == 200
    data = response_index.json()
    assert data["engine"] == "FAGE (Fraud Analytics & Governance Engine)"
    assert data["status"] == "online"

    response_health = client.get("/health")
    assert response_health.status_code == 200
    health_data = response_health.json()
    assert health_data["status"] == "healthy"
    assert health_data["service"] == "fage-backend"


def test_unauthorized_access():
    endpoints = [
        ("/dashboard", "GET"),
        ("/cost-thresholds", "GET"),
        ("/pu-calibration", "GET"),
        ("/alerts", "GET"),
    ]
    for url, method in endpoints:
        if method == "GET":
            resp = client.get(url)
        else:
            resp = client.post(url, json={})
        assert resp.status_code == 401, f"Expected 401 for unauthorized {method} {url}"
        assert "detail" in resp.json()


def test_login_and_jwt_access():
    bad = client.post("/token", data={"username": "admin", "password": "wrong"})
    assert bad.status_code == 401

    ok = client.post("/token", data={"username": "admin", "password": "admin123"})
    assert ok.status_code == 200
    body = ok.json()
    assert "access_token" in body
    assert body["user"]["role"] == "admin"

    headers = {"Authorization": f"Bearer {body['access_token']}"}
    me = client.get("/me", headers=headers)
    assert me.status_code == 200
    assert me.json()["username"] == "admin"

    dash = client.get("/dashboard", headers=headers)
    assert dash.status_code == 200
    assert "unique_accounts_analysed" in dash.json()["telemetry"]


def test_audit_logs_role_gate():
    analyst = client.post("/token", data={"username": "analyst", "password": "analyst123"})
    assert analyst.status_code == 200
    a_headers = {"Authorization": f"Bearer {analyst.json()['access_token']}"}
    denied = client.get("/audit-logs", headers=a_headers)
    assert denied.status_code == 403

    admin = client.post("/token", data={"username": "admin", "password": "admin123"})
    adm_headers = {"Authorization": f"Bearer {admin.json()['access_token']}"}
    allowed = client.get("/audit-logs", headers=adm_headers)
    assert allowed.status_code == 200
    assert "logs" in allowed.json()


def test_dashboard_authenticated():
    resp = client.get("/dashboard", headers=VALID_HEADERS)
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "success"
    assert "telemetry" in data
    assert "models" in data


def test_cost_thresholds():
    resp = client.get("/cost-thresholds", headers=VALID_HEADERS)
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "success"
    assert "c_fn" in data
    assert "c_fp" in data
    assert "optimal_threshold" in data


def test_pu_calibration_get():
    resp = client.get("/pu-calibration", headers=VALID_HEADERS)
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "success"
    assert "c_estimate" in data
    assert "spy_threshold" in data


def test_pu_calibration_post():
    payload = {
        "raw_probabilities": [0.10, 0.45, 0.88],
        "c_factor": 0.80
    }
    resp = client.post("/pu-calibration", headers=VALID_HEADERS, json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "success"
    assert data["c_factor_used"] == 0.80
    assert len(data["calibrated_probabilities"]) == 3
    assert data["calibrated_probabilities"][2] > data["raw_probabilities"][2]


def test_triage_eval_post():
    payload = {
        "risk_score": 88.5,
        "ci_lower": 0.80,
        "ci_upper": 0.95,
        "evadable": False,
        "pu_probability": 0.85,
        "account_id": "ACC-TEST-123"
    }
    resp = client.post("/triage-eval", headers=VALID_HEADERS, json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "success"
    assert "triage_evaluation" in data
    eval_res = data["triage_evaluation"]
    assert "triage_action" in eval_res
    assert "priority_tier" in eval_res


def test_alerts_queue():
    resp = client.get("/alerts", headers=VALID_HEADERS)
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "success"
    assert "alerts" in data
    assert "alerts_count" in data


def test_analyst_feedback_recalibration():
    payload = {
        "alert_id": "ALT-1001",
        "label": "True Positive",
        "analyst_notes": "Confirmed mule account behavior via closed-loop review",
        "trigger_recalibration": True
    }
    resp = client.post("/feedback", headers=VALID_HEADERS, json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "success"
    assert data["alert_id"] == "ALT-1001"
    assert data["label_recorded"] == "True Positive"
    assert data["recalibration_triggered"] is True
    assert "old_c_factor" in data
    assert "new_c_factor" in data


def test_spy_threshold_tuning():
    payload = {
        "spy_threshold": 0.015,
        "c_factor": 0.75
    }
    resp = client.post("/pu-calibration/tune", headers=VALID_HEADERS, json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "success"
    assert data["new_spy_threshold"] == 0.015
    assert data["new_c_factor"] == 0.75

