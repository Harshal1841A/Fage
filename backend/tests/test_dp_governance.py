import os
import sys
import pytest
from fastapi.testclient import TestClient

# Add parent pathing to python import stream
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "app"))

from app.main import app
from app.auth import get_current_user, verify_api_key, AuthUser
from app.db import get_db, Base, engine, SessionLocal
from app.ml.dp_engine import dp_engine, PrivacyBudgetExceededError

# Override Auth for testing
def override_get_current_user():
    return AuthUser(
        username="admin_test",
        display_name="Admin Test",
        role="admin",
        permissions=["read", "write", "admin"],
        auth_method="test_override"
    )

def override_get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

@pytest.fixture(autouse=True)
def setup_overrides():
    app.dependency_overrides[get_current_user] = override_get_current_user
    app.dependency_overrides[verify_api_key] = override_get_current_user
    app.dependency_overrides[get_db] = override_get_db
    yield
    app.dependency_overrides.clear()

client = TestClient(app)



def test_dp_engine_math_and_budget():
    dp_engine.reset_budget(10.0)
    # Test Laplace noise
    noisy, scale = dp_engine.apply_laplace_mechanism(100.0, sensitivity=1.0, epsilon=0.5)
    assert scale == 2.0
    assert isinstance(noisy, float)

    # Test Gaussian noise
    noisy_g, sigma = dp_engine.apply_gaussian_mechanism(100.0, sensitivity=1.0, epsilon=0.5, delta=1e-5)
    assert sigma > 0
    assert isinstance(noisy_g, float)

    # Test Reidentification risk calculation
    reid = dp_engine.compute_reidentification_risk(node_count=50, edge_count=100, max_degree=15, structuring_nodes=10)
    assert "reid_risk_score" in reid
    assert "k_anonymity_estimate" in reid
    assert "l_diversity_index" in reid


def test_dp_metrics_endpoint():
    dp_engine.reset_budget(10.0)
    res = client.get("/metrics/dp?epsilon=0.5&mechanism=laplace")
    assert res.status_code == 200
    data = res.json()
    assert "noisy_metrics" in data
    assert data["status"] == "success"
    assert "privacy_guarantee" in data
    assert data["epsilon_cost"] == 0.5
    assert data["budget_status"]["spent_epsilon"] >= 0.5


def test_dp_graph_summary_endpoint():
    res = client.post("/export/graph-summary", json={"epsilon": 0.4, "mechanism": "gaussian"})
    assert res.status_code == 200
    data = res.json()
    assert "noisy_summary" in data
    assert "reidentification_risk_assessment" in data
    assert data["noisy_summary"]["node_count_dp"] >= 1
    assert data["reidentification_risk_assessment"]["k_anonymity_estimate"] >= 1


def test_dp_budget_exhaustion_and_reset():
    # Exhaust budget intentionally
    dp_engine.reset_budget(0.2)
    with pytest.raises(PrivacyBudgetExceededError):
        dp_engine._consume_budget(0.5, "TEST", "LAPLACE", 1.0)
    
    # Test endpoint when budget exhausted
    res = client.get("/metrics/dp?epsilon=0.5")
    assert res.status_code == 429
    assert "Privacy budget exceeded" in res.json()["detail"]

    # Now reset budget
    res_reset = client.post("/governance/dp-reset", json={"max_epsilon": 10.0})
    assert res_reset.status_code == 200
    assert res_reset.json()["budget_status"]["remaining_epsilon"] == 10.0

    # Verify status endpoint
    res_status = client.get("/governance/dp-status")
    assert res_status.status_code == 200
    assert res_status.json()["budget_status"]["max_epsilon"] == 10.0
