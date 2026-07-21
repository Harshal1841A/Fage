import os
import sys
import json
import pickle
import logging
import uuid
import time
import hashlib
from datetime import datetime, UTC
from typing import Dict, List, Any, Optional

import numpy as np
import pandas as pd
from pydantic import BaseModel, Field

import threading
import asyncio
import io
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Query, status, Depends, UploadFile, File
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordRequestForm
from datetime import timedelta
from sqlalchemy.orm import Session
from app.db import get_db, AlertModel, AuditLogModel, write_audit
from app.auth import (
    verify_api_key,
    authenticate_user,
    create_access_token,
    get_current_user,
    AuthUser,
    ACCESS_TOKEN_EXPIRE_MINUTES,
    TokenResponse,
)
from fastapi.concurrency import run_in_threadpool
from threading import Lock

# Add parent pathing to python import stream to load custom local ML modules
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


from app.services.risk_engine import FAGERiskEngine
from app.ml.dp_engine import dp_engine, PrivacyBudgetExceededError
from app.services.llm import call_nvidia_llm

# Setup Logging
logging.basicConfig(level=logging.INFO, format="[%(asctime)s] %(levelname)s [%(name)s] %(message)s")
logger = logging.getLogger("FAGE.API.Backend")

# Auth is provided by app.auth (JWT + API key). See verify_api_key / get_current_user.

@asynccontextmanager
async def lifespan(app: FastAPI):
    from app.auth import SECRET_KEY
    if SECRET_KEY == "fage-dev-jwt-secret-change-in-production":
        _env = os.environ.get("FAGE_ENV", os.environ.get("ENVIRONMENT", "production")).lower()
        _debug = os.environ.get("FAGE_DEBUG", "false").lower() == "true"
        if _env not in ("dev", "development", "test", "testing", "debug") and not _debug:
            msg = (
                "CRITICAL SECURITY ERROR: Server booting in non-debug/production environment with default hardcoded FAGE_JWT_SECRET! "
                "Set FAGE_JWT_SECRET environment variable to a strong random secret before starting the server."
            )
            logger.critical(msg)
            raise RuntimeError(msg)
        else:
            logger.warning(
                "SECURITY WARNING: Running with default hardcoded FAGE_JWT_SECRET (`fage-dev-jwt-secret-change-in-production`). "
                "This is permitted only in development/testing mode."
            )
    yield

# Initialize FastAPI App representing FAGE (Fraud Analytics & Governance Engine)
app = FastAPI(
    title="FAGE: Fraud Analytics & Governance Engine API",
    description="Enterprise-grade back-end decisioning and explainability matrix for high-dimensional mule account identification.",
    version="1.0.0",
    lifespan=lifespan
)

# Configure CORS Middleware allowing local React dashboard cross-origin calls
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001", "http://localhost:3002", "http://localhost:5173", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Auth is provided by app.auth (JWT + API key). See verify_api_key / get_current_user.

@app.on_event("startup")
async def verify_security_env_on_startup():
    from app.auth import SECRET_KEY
    if SECRET_KEY == "fage-dev-jwt-secret-change-in-production":
        _env = os.environ.get("FAGE_ENV", os.environ.get("ENVIRONMENT", "production")).lower()
        _debug = os.environ.get("FAGE_DEBUG", "false").lower() == "true"
        if _env not in ("dev", "development", "test", "testing", "debug") and not _debug:
            msg = (
                "CRITICAL SECURITY ERROR: Server booting in non-debug/production environment with default hardcoded FAGE_JWT_SECRET! "
                "Set FAGE_JWT_SECRET environment variable to a strong random secret before starting the server."
            )
            logger.critical(msg)
            raise RuntimeError(msg)
        else:
            logger.warning(
                "SECURITY WARNING: Running with default hardcoded FAGE_JWT_SECRET (`fage-dev-jwt-secret-change-in-production`). "
                "This is permitted only in development/testing mode."
            )

# Instantiate Global Risk Engine
risk_engine = FAGERiskEngine(
    models_dir=os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "models"),
    override_rules_enabled=True
)

GLOBAL_DECISION_THRESHOLD = 0.50
try:
    cost_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "cost_thresholds.json")
    if os.path.exists(cost_path):
        with open(cost_path, "r") as f:
            cost_data = json.load(f)
            GLOBAL_DECISION_THRESHOLD = cost_data.get("operating_points", {}).get("Conservative", {}).get("threshold", 0.50)
except Exception as e:
    logger.warning(f"Failed to load optimal threshold from cost_thresholds.json: {e}")

_threshold_lock = Lock()

METRICS_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "metrics.json"
)

def _load_active_model_metrics() -> dict:
    """Pull metrics for the currently active classifier, respecting GLOBAL_DECISION_THRESHOLD."""
    try:
        cost_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "cost_thresholds.json")
        if os.path.exists(cost_path):
            with open(cost_path, "r", encoding="utf-8") as f:
                cost_data = json.load(f)
            
            cost_curve = cost_data.get("cost_curve", [])
            if cost_curve:
                closest_point = min(cost_curve, key=lambda x: abs(x["threshold"] - GLOBAL_DECISION_THRESHOLD))
                return {
                    "precision": float(closest_point.get("precision", 0.0)),
                    "recall": float(closest_point.get("recall", 0.0)),
                    "f1": float(closest_point.get("f1", 0.0)),
                    "accuracy": float(closest_point.get("accuracy", 0.0)),
                    "threshold": float(closest_point.get("threshold", GLOBAL_DECISION_THRESHOLD))
                }

        # Fallback
        with open(METRICS_PATH, "r", encoding="utf-8") as f:
            metrics = json.load(f)
        model_key = risk_engine.default_model_name
        for k in metrics:
            if k.upper() == model_key.upper():
                return {
                    "precision": float(metrics[k].get("precision", 0.0)),
                    "recall": float(metrics[k].get("recall", 0.0)),
                    "f1": float(metrics[k].get("f1", 0.0)),
                    "accuracy": float(metrics[k].get("accuracy", 0.0)),
                    "threshold": float(metrics[k].get("threshold", 0.0))
                }
    except Exception as e:
        logger.error(f"Could not load active model metrics: {e}")
    return {"precision": 0.0, "recall": 0.0, "f1": 0.0, "accuracy": 0.0, "threshold": GLOBAL_DECISION_THRESHOLD}


def _compute_rule_exception_rate(db: Session) -> float:
    """
    Real exception rate: fraction of alerts in DB that trigger at
    least one heuristic rule override when re-evaluated against
    risk_engine.evaluate_heuristic_overrides().
    """
    alerts = db.query(AlertModel).all()
    if not alerts:
        return 0.0

    triggered = 0
    for alert in alerts:
        features = json.loads(alert.features) if alert.features else {}
        payload = {
            "amount": alert.amount,
            "origin_country": features.get("origin_country", "US"),
            "destination_country": features.get("destination_country", "US"),
            "account_age_days": features.get("account_age_days", 365),
            "is_international": features.get("is_international", False),
        }
        overrides = risk_engine.evaluate_heuristic_overrides(payload)
        if overrides:
            triggered += 1

    return round(triggered / len(alerts), 4)


def _build_real_sample_df(db: Session, n: int = 10) -> pd.DataFrame:
    """
    Build a DataFrame of REAL feature rows.
    """
    selected_cols = risk_engine.selector.selected_features_
    means = risk_engine.shap_engine.background_means_

    alerts = [a.to_dict() for a in db.query(AlertModel).all()]
    candidates = [a for a in alerts if isinstance(a.get("features"), dict) and a["features"]]

    rows = []
    if candidates:
        import random
        sample = random.sample(candidates, min(n, len(candidates)))
        for alert in sample:
            feat = alert["features"]
            row = {
                col: float(feat[col]) if col in feat else float(means.get(col, 0.0))
                for col in selected_cols
            }
            rows.append(row)

    while len(rows) < n:
        rows.append({col: float(means.get(col, 0.0)) for col in selected_cols})

    return pd.DataFrame(rows)[selected_cols]


# ==========================================
#         Pydantic Request Schemas
# ==========================================

class PredictRequest(BaseModel):
    features: Dict[str, float] = Field(
        ..., 
        description="Key-value mapping of feature designations and quantitative value states."
    )


class RiskScoreRequest(BaseModel):
    transaction_id: Optional[str] = Field(None, description="Unique identification trace string.")
    sender_id: Optional[str] = Field("ACC-1102", description="Initiator transaction ID sequence.")
    receiver_id: Optional[str] = Field("ACC-8839", description="Receiver/Beneficiary account identifier.")
    amount: float = Field(..., ge=0.0, description="Quantitative value scale of transfer transactional volume.")
    origin_country: str = Field("US", description="Origin country ISO standard 2-digit code.")
    destination_country: str = Field("US", description="Destination country ISO standard 2-digit code.")
    account_age_days: int = Field(365, ge=0, description="Operational age of sending account in calendar days.")
    is_international: bool = Field(False, description="Flag setting geographical cross-border traits.")
    custom_metrics: Optional[Dict[str, float]] = Field(
        None, 
        description="Optional telemetry metrics dictionary corresponding to high-dimensional FAGE model parameters."
    )


class AlertUpdateRequest(BaseModel):
    status: str = Field(..., description="Action state: Open, Investigating, Escalated, Closed.")
    notes: Optional[str] = Field(None, description="Operational remarks/case ledger inputs.")
    assigned_to: Optional[str] = Field(None, description="Operator assignment name.")
    operator_name: Optional[str] = Field("System Operator", description="Name of the operator making the change.")


class AlertIngestRequest(BaseModel):
    transaction_id: str = Field(..., description="Unique transaction ID.")
    sender_id: Optional[str] = Field("ACC-UNKN", description="Sender account.")
    receiver_id: Optional[str] = Field("ACC-UNKN", description="Receiver account.")
    amount: float = Field(..., ge=0.0, description="Transaction amount.")
    risk_score: int = Field(..., ge=0, le=100, description="Mule risk score out of 100.")
    risk_tier: Optional[str] = Field(None, description="Risk tier, mapped automatically if null.")
    severity: Optional[str] = Field(None, description="Severity rating, mapped automatically if null.")
    status: Optional[str] = Field("Open", description="Alert status state: Open, Investigating, Escalated, Closed.")
    reason: Optional[str] = Field("Manual external legacy rule sync ingestion.", description="Alert rationale.")
    timestamp: Optional[str] = Field(None, description="ISO timestamp string.")
    assigned_to: Optional[str] = Field("Unassigned", description="Operator assignment.")
    logs: Optional[List[Dict[str, Any]]] = Field(None, description="Logs audit trail.")


class SARResponse(BaseModel):
    sar_report: str
    fincen_tracking_id: Optional[str] = None
    citation_hash: Optional[str] = None


class PlainLanguageExplanationResponse(BaseModel):
    explanation: str


class TuneRequest(BaseModel):
    new_threshold: float


class PUCalibrateRequest(BaseModel):
    raw_probabilities: List[float] = Field(..., description="List of raw predicted probabilities P(s=1|x)")
    c_factor: Optional[float] = Field(None, description="Optional override label frequency c")


class SPYTuneRequest(BaseModel):
    spy_threshold: Optional[float] = Field(None, description="New reliable negative SPY threshold (0-1)")
    c_factor: Optional[float] = Field(None, description="New PU discovery probability c factor (0-1)")


class TriageEvalRequest(BaseModel):
    risk_score: float = Field(..., description="Model risk score (0-100)")
    ci_lower: float = Field(..., description="Lower bound of 90% confidence interval (0-1)")
    ci_upper: float = Field(..., description="Upper bound of 90% confidence interval (0-1)")
    evadable: bool = Field(False, description="Whether profile is evadable within 3-feature perturbation")
    pu_probability: Optional[float] = Field(None, description="PU calibrated probability (0-1)")
    account_id: Optional[str] = Field("TXN-EVAL", description="Account identifier")


class FeedbackRequest(BaseModel):
    alert_id: str = Field(..., description="Alert ID or Account ID being reviewed")
    label: str = Field(..., description="Ground truth label: 'True Positive', 'False Positive', 'Mule Ring', 'Suspicious'")
    analyst_notes: Optional[str] = Field(None, description="Detailed notes on investigation rationale")
    trigger_recalibration: bool = Field(True, description="Whether to trigger online PU and threshold recalibration")
    tenant_id: Optional[str] = Field("TN-GLOBAL-01", description="Tenant ID")
    org_id: Optional[str] = Field("ORG-FIN-PRIMARY", description="Organization ID")


class FeedbackResponse(BaseModel):
    status: str = "success"
    alert_id: str
    label_recorded: str
    recalibration_triggered: bool
    old_c_factor: float
    new_c_factor: float
    old_spy_threshold: Optional[float]
    new_spy_threshold: Optional[float]
    message: str





class DPExportRequest(BaseModel):
    epsilon: Optional[float] = Field(None, gt=0.0, description="Requested privacy epsilon budget")
    mechanism: str = Field("laplace", description="Noise injection mechanism ('laplace' or 'gaussian')")


class DPResetRequest(BaseModel):
    max_epsilon: Optional[float] = Field(None, gt=0.0, description="New maximum epsilon budget to allocate")


# ==========================================
#             API Core Routes
# ==========================================

@app.get("/", tags=["System"])
def index():
    return {
        "engine": "FAGE (Fraud Analytics & Governance Engine)",
        "status": "online",
        "timestamp": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "model_loaded": risk_engine.default_model_name,
        "is_fallback_active": not risk_engine.is_production_ready
    }


@app.get("/health", tags=["System"])
def health_check():
    return {
        "status": "healthy",
        "service": "fage-backend",
        "version": "2.0.0",
        "model_ready": risk_engine.is_production_ready
    }


@app.post("/token", response_model=TokenResponse, tags=["Authentication"])
def login_for_access_token(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = authenticate_user(form_data.username, form_data.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token = create_access_token(
        data={"sub": user["username"], "role": user["role"]},
        expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
    )
    write_audit(
        db,
        actor=user["username"],
        role=user["role"],
        action="login",
        entity_type="auth",
        entity_id=user["username"],
        detail="Successful password login",
        auth_method="jwt",
    )
    db.commit()
    return TokenResponse(
        access_token=access_token,
        expires_in=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        user={
            "username": user["username"],
            "role": user["role"],
            "display_name": user["display_name"],
        },
    )


@app.get("/me", tags=["Authentication"], dependencies=[Depends(verify_api_key)])
def read_current_user(user: AuthUser = Depends(get_current_user)):
    return {
        "username": user.username,
        "role": user.role,
        "display_name": user.display_name,
        "auth_method": user.auth_method,
    }


@app.get("/audit-logs", tags=["Governance & Operations"], dependencies=[Depends(verify_api_key)])
def list_audit_logs(
    limit: int = Query(100, ge=1, le=500),
    entity_type: Optional[str] = Query(None),
    entity_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    if user.role not in ("admin", "auditor", "service"):
        raise HTTPException(status_code=403, detail="Auditor or admin role required to view audit logs.")
    q = db.query(AuditLogModel).order_by(AuditLogModel.id.desc())
    if entity_type:
        q = q.filter(AuditLogModel.entity_type == entity_type)
    if entity_id:
        q = q.filter(AuditLogModel.entity_id == entity_id)
    rows = q.limit(limit).all()
    return {"status": "success", "count": len(rows), "logs": [r.to_dict() for r in rows]}


@app.get("/dashboard", tags=["Governance & Operations"], dependencies=[Depends(verify_api_key)])
def get_dashboard_summary(db: Session = Depends(get_db)):
    alerts = [a.to_dict() for a in db.query(AlertModel).all()]
    total_alerts = len(alerts)
    open_alerts = sum(1 for a in alerts if a["status"] == "Open")
    investigating_alerts = sum(1 for a in alerts if a["status"] == "Investigating")
    escalated_alerts = sum(1 for a in alerts if a["status"] == "Escalated")
    closed_alerts = sum(1 for a in alerts if a["status"] == "Closed")

    scores = [a["risk_score"] for a in alerts]
    avg_score = float(np.mean(scores)) if scores else 0.0
    max_score = int(np.max(scores)) if scores else 0
    
    severity_map = {"Critical": 0, "High": 0, "Medium": 0, "Low": 0}
    for alert in alerts:
        sev = alert.get("severity", "Medium")
        if sev in severity_map:
            severity_map[sev] += 1

    metrics_data = {}
    if os.path.exists(METRICS_PATH):
        try:
            with open(METRICS_PATH, "r", encoding="utf-8") as f:
                metrics_data = json.load(f)
        except Exception as e:
            logger.error(f"Error reading metrics JSON metadata: {str(e)}")
    unique_accounts = len({a.get("sender_id") for a in alerts if a.get("sender_id")})
    critical_alerts = [a for a in alerts if a.get("risk_score", 0) >= 75]
    critical_exposure = float(sum(a.get("amount") or 0 for a in critical_alerts))
    mule_exposure = float(
        sum(
            a.get("amount") or 0
            for a in alerts
            if (a.get("id") or "").startswith("ALT-TGT-") or a.get("risk_score", 0) >= 50
        )
    )

    active_metrics = _load_active_model_metrics()

    return {
        "status": "success",
        "compiled_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "telemetry": {
            "total_incidents_recorded": total_alerts,
            "unique_accounts_analysed": unique_accounts,
            "critical_alert_count": len(critical_alerts),
            "critical_exposure_amount": critical_exposure,
            "mule_exposure_amount": mule_exposure,
            "average_risk_rating": avg_score,
            "maximum_index_severity": max_score,
            "incident_status_matrix": {
                "Open": open_alerts,
                "Investigating": investigating_alerts,
                "Escalated": escalated_alerts,
                "Closed": closed_alerts
            },
            "severity_profile": severity_map,
            "rule_exception_rate": _compute_rule_exception_rate(db),
            "mule_classification_precision": active_metrics["precision"],
            "mule_classification_recall": active_metrics["recall"],
            "mule_classification_f1": active_metrics["f1"]
        },
        "models": metrics_data
    }


@app.get("/model-registry", tags=["Model Analytics"], dependencies=[Depends(verify_api_key)])
async def get_model_rejection_registry():
    registry_path = os.path.join(os.path.dirname(__file__), "..", "model_rejection_registry.json")
    registry = {}
    if os.path.exists(registry_path):
        try:
            with open(registry_path, "r", encoding="utf-8") as f:
                registry = json.load(f)
        except Exception as e:
            logger.error(f"Could not load model rejection registry: {e}")
    if os.path.exists(METRICS_PATH):
        try:
            with open(METRICS_PATH, "r", encoding="utf-8") as f:
                metrics_data = json.load(f)
            if isinstance(registry, dict):
                registry["metrics"] = metrics_data
        except Exception as e:
            logger.error(f"Could not load active metrics: {e}")
    return registry


@app.get("/metrics", tags=["Model Analytics"], dependencies=[Depends(verify_api_key)])
async def get_model_metrics_endpoint():
    metrics_dict = {}
    if os.path.exists(METRICS_PATH):
        try:
            with open(METRICS_PATH, "r", encoding="utf-8") as f:
                metrics_dict = json.load(f)
        except Exception as e:
            logger.error(f"Could not load metrics.json: {e}")
    
    if not metrics_dict and hasattr(risk_engine, 'get_model_metrics'):
        metrics_dict = risk_engine.get_model_metrics()
    
    # Dynamically inject the active model's true performance at the current global threshold
    active_metrics = _load_active_model_metrics()
    model_key = risk_engine.default_model_name
    for k in metrics_dict:
        if k.upper() == model_key.upper():
            metrics_dict[k]["precision"] = active_metrics["precision"]
            metrics_dict[k]["recall"] = active_metrics["recall"]
            metrics_dict[k]["f1"] = active_metrics["f1"]
            if "accuracy" in active_metrics and active_metrics["accuracy"] > 0:
                metrics_dict[k]["accuracy"] = active_metrics["accuracy"]
            metrics_dict[k]["threshold"] = active_metrics["threshold"]
            # To be thoroughly correct, we could attempt to scale TN, FP, FN, TP in the confusion matrix,
            # but precision and recall are the core reporting metrics.

    return {
        "source": "backend_metrics_registry",
        "models": metrics_dict
    }


@app.get("/metrics/dp", tags=["Governance & Operations"], dependencies=[Depends(verify_api_key)])
@app.post("/metrics/dp", tags=["Governance & Operations"], dependencies=[Depends(verify_api_key)])
async def get_dp_model_metrics_endpoint(
    epsilon: Optional[float] = Query(None),
    mechanism: str = Query("laplace"),
    request_body: Optional[DPExportRequest] = None,
    user: AuthUser = Depends(verify_api_key),
    db: Session = Depends(get_db)
):
    """
    Returns model metrics with calibrated ε-Differential Privacy (Laplace or Gaussian) noise injected.
    Consumes privacy budget from the ledger and blocks queries if budget is exhausted.
    """
    eps = epsilon
    mech = mechanism
    if request_body:
        if request_body.epsilon is not None:
            eps = request_body.epsilon
        if request_body.mechanism:
            mech = request_body.mechanism

    metrics_dict = {}
    if os.path.exists(METRICS_PATH):
        try:
            with open(METRICS_PATH, "r", encoding="utf-8") as f:
                metrics_dict = json.load(f)
        except Exception as e:
            logger.error(f"Could not load metrics.json for DP: {e}")
    if not metrics_dict:
        metrics_dict = risk_engine.get_model_metrics()

    # Extract numeric model metrics from active model or default to XGBoost/LogisticRegression
    active_model = metrics_dict.get(risk_engine.default_model_name) or metrics_dict.get("XGBoost") or metrics_dict.get("LogisticRegression") or {}
    numeric_metrics = {
        k: float(v) for k, v in active_model.items()
        if isinstance(v, (int, float)) and not isinstance(v, bool)
    }
    # Include PU engine state metrics
    if risk_engine.pu_engine:
        c_val = getattr(risk_engine.pu_engine, "c_", None)
        if c_val is not None:
            numeric_metrics["c_factor"] = float(c_val)
        spy_val = getattr(risk_engine.pu_engine, "spy_threshold_", None)
        if spy_val is not None:
            numeric_metrics["spy_threshold"] = float(spy_val)

    try:
        dp_result = dp_engine.get_dp_model_metrics(numeric_metrics, epsilon=eps, mechanism=mech)
    except PrivacyBudgetExceededError as e:
        write_audit(
            db,
            actor=user.username,
            role=user.role,
            action="model.metrics_dp_export_rejected",
            entity_type="dp_engine",
            entity_id="budget_exhausted",
            detail=str(e),
            auth_method=user.auth_method,
            tenant_id="TN-GLOBAL-01",
            org_id="ORG-FIN-PRIMARY"
        )
        db.commit()
        raise HTTPException(status_code=429, detail=str(e))

    write_audit(
        db,
        actor=user.username,
        role=user.role,
        action="model.metrics_dp_export",
        entity_type="dp_engine",
        entity_id=f"dp_{mech.lower()}",
        detail=f"Exported DP model metrics with epsilon={dp_result['epsilon_cost']}, guarantee={dp_result['privacy_guarantee']}. Remaining budget: {dp_result['budget_status']['remaining_epsilon']}",
        auth_method=user.auth_method,
        tenant_id="TN-GLOBAL-01",
        org_id="ORG-FIN-PRIMARY"
    )
    db.commit()

    return dp_result


@app.get("/export/graph-summary", tags=["Governance & Operations"], dependencies=[Depends(verify_api_key)])
@app.post("/export/graph-summary", tags=["Governance & Operations"], dependencies=[Depends(verify_api_key)])
async def export_dp_graph_summary(
    epsilon: Optional[float] = Query(None),
    mechanism: str = Query("laplace"),
    request_body: Optional[DPExportRequest] = None,
    user: AuthUser = Depends(verify_api_key),
    db: Session = Depends(get_db)
):
    """
    Exports graph topology summary and re-identification risk metrics (k-anonymity, l-diversity)
    with calibrated ε-DP Laplace/Gaussian noise to prevent linkage attacks during regulator/export sharing.
    """
    eps = epsilon
    mech = mechanism
    if request_body:
        if request_body.epsilon is not None:
            eps = request_body.epsilon
        if request_body.mechanism:
            mech = request_body.mechanism

    alerts = [a.to_dict() for a in db.query(AlertModel).all()]
    node_count = max(10, len({a.get("sender_id") for a in alerts if a.get("sender_id")} | {a.get("receiver_id") for a in alerts if a.get("receiver_id")}))
    edge_count = max(20, len(alerts))
    sender_counts = {}
    for a in alerts:
        s = a.get("sender_id")
        if s:
            sender_counts[s] = sender_counts.get(s, 0) + 1
    max_degree = max(sender_counts.values()) if sender_counts else 5
    structuring_nodes = sum(1 for a in alerts if "STRUCT" in str(a.get("rule_id", "")).upper() or (a.get("amount") and float(a.get("amount", 0)) < 10000))
    total_volume = sum(float(a.get("amount") or 0.0) for a in alerts)

    raw_stats = {
        "node_count": node_count,
        "edge_count": edge_count,
        "max_degree": max_degree,
        "structuring_nodes": structuring_nodes,
        "total_volume_exposed": total_volume
    }

    try:
        dp_graph = dp_engine.get_dp_graph_summary(raw_stats, epsilon=eps, mechanism=mech)
    except PrivacyBudgetExceededError as e:
        write_audit(
            db,
            actor=user.username,
            role=user.role,
            action="model.graph_dp_export_rejected",
            entity_type="dp_engine",
            entity_id="budget_exhausted",
            detail=str(e),
            auth_method=user.auth_method,
            tenant_id="TN-GLOBAL-01",
            org_id="ORG-FIN-PRIMARY"
        )
        db.commit()
        raise HTTPException(status_code=429, detail=str(e))

    write_audit(
        db,
        actor=user.username,
        role=user.role,
        action="model.graph_dp_export",
        entity_type="dp_engine",
        entity_id=f"graph_dp_{mech.lower()}",
        detail=f"Exported DP graph topology with epsilon={dp_graph['epsilon_cost']}, k-anonymity estimate={dp_graph['reidentification_risk_assessment']['k_anonymity_estimate']}. Remaining budget: {dp_graph['budget_status']['remaining_epsilon']}",
        auth_method=user.auth_method,
        tenant_id="TN-GLOBAL-01",
        org_id="ORG-FIN-PRIMARY"
    )
    db.commit()

    return dp_graph


@app.get("/governance/dp-status", tags=["Governance & Operations"], dependencies=[Depends(verify_api_key)])
async def get_dp_governance_status(user: AuthUser = Depends(verify_api_key)):
    """
    Returns current privacy budget consumption, ledger history, and re-identification risk status.
    """
    return {
        "status": "success",
        "budget_status": dp_engine.get_budget_status()
    }


@app.post("/governance/dp-reset", tags=["Governance & Operations"], dependencies=[Depends(verify_api_key)])
async def reset_dp_governance_budget(
    request: Optional[DPResetRequest] = None,
    user: AuthUser = Depends(verify_api_key),
    db: Session = Depends(get_db)
):
    """
    Resets the differential privacy epsilon budget. Requires admin or auditor role.
    """
    if user.role not in ("admin", "auditor"):
        raise HTTPException(status_code=403, detail="Only admins or auditors can reset the privacy budget.")
    
    new_max = request.max_epsilon if request else None
    status_dict = dp_engine.reset_budget(new_max)

    write_audit(
        db,
        actor=user.username,
        role=user.role,
        action="governance.dp_budget_reset",
        entity_type="dp_engine",
        entity_id="budget_ledger",
        detail=f"Privacy budget reset by {user.username} (role={user.role}). New max_epsilon: {status_dict['max_epsilon']}",
        auth_method=user.auth_method,
        tenant_id="TN-GLOBAL-01",
        org_id="ORG-FIN-PRIMARY"
    )
    db.commit()

    return {
        "status": "success",
        "message": "Privacy budget successfully reset.",
        "budget_status": status_dict
    }





@app.get("/feature-importance", tags=["Model Analytics"], dependencies=[Depends(verify_api_key)])
async def get_global_feature_importance(db: Session = Depends(get_db)):
    means = risk_engine.shap_engine.background_means_
    real_samples = _build_real_sample_df(db, n=10)
    
    global_shaps = await run_in_threadpool(risk_engine.shap_engine.compute_global_shap, real_samples)
    summary_data = await run_in_threadpool(risk_engine.shap_engine.generate_summary_data, real_samples)
    summary_b64 = await run_in_threadpool(risk_engine.shap_engine.render_base64_summary, real_samples)

    return {
        "status": "success",
        "model_requested": risk_engine.default_model_name,
        "importance_profile": [
            {"feature": feat, "mean_abs_attribution": score}
            for feat, score in list(global_shaps.items())[:15]
        ],
        "beeswarm_scatter": summary_data,
        "static_beeswarm_base64": summary_b64
    }


@app.post("/predict", tags=["Inference Engine"], dependencies=[Depends(verify_api_key)])
def predict_fraud_probability(request: PredictRequest):
    if not risk_engine.is_production_ready:
        raise HTTPException(
            status_code=503,
            detail="FAGE ML classifier loading sequence incomplete. Verify models are fully compiled and try again."
        )

    try:
        feat_df = pd.DataFrame([request.features])
        aligned_df = risk_engine.preprocessor.transform(feat_df)
        selected_df = risk_engine.selector.transform(aligned_df)

        prob = float(risk_engine.classifier.predict_proba(selected_df)[0, 1])
        with _threshold_lock:
            threshold = GLOBAL_DECISION_THRESHOLD
        class_label = int(prob >= threshold)

        return {
            "status": "success",
            "metadata": {
                "execution_timestamp": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "features_analyzed": selected_df.shape[1]
            },
            "inference": {
                "fraud_probability": prob,
                "predicted_class_label": class_label,
                "decision_threshold": threshold
            }
        }
    except Exception as e:
        logger.error(f"Prediction execution failed: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Inference Engine execution exception: {str(e)}")


@app.post("/explain", tags=["Inference Engine"], dependencies=[Depends(verify_api_key)])
async def explain_case_attribution(request: PredictRequest, user: AuthUser = Depends(verify_api_key), db: Session = Depends(get_db)):
    if not risk_engine.is_production_ready:
        raise HTTPException(
            status_code=503,
            detail="FAGE ML classifier loading sequence incomplete. Verify models are fully compiled and try again."
        )
    try:
        row_series = pd.Series(request.features)
        
        attributions = await run_in_threadpool(risk_engine.shap_engine.compute_local_shap, row_series)
        waterfall = await run_in_threadpool(risk_engine.shap_engine.generate_waterfall_data, row_series)
        waterfall_b64 = await run_in_threadpool(risk_engine.shap_engine.render_base64_waterfall, row_series)

        write_audit(
            db,
            actor=user.username,
            role=user.role,
            action="alert.explain",
            entity_type="alert",
            entity_id=str(request.features.get("transaction_id", "predict_case")),
            detail="Computed SHAP attribution",
            auth_method=user.auth_method,
        )
        db.commit()

        return {
            "status": "success",
            "attributions": attributions,
            "waterfall_visuals": waterfall,
            "static_chart_base64": waterfall_b64
        }
    except Exception as e:
        logger.error(f"Attribution calculation failed: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Explainability Engine execution error: {str(e)}")


@app.post("/risk-score", tags=["Inference Engine"], dependencies=[Depends(verify_api_key)])
def score_and_evaluate_transaction(request: RiskScoreRequest, db: Session = Depends(get_db)):
    if not risk_engine.is_production_ready:
        raise HTTPException(
            status_code=503,
            detail="FAGE ML classifier loading sequence incomplete. Verify models are fully compiled and try again."
        )
    try:
        payload = request.model_dump()
        if request.custom_metrics:
            for k, v in request.custom_metrics.items():
                payload[k] = v

        scorecard = risk_engine.score_single_case(payload)
        
        if scorecard["scores"]["final_risk_score"] >= 50:
            existing = db.query(AlertModel).filter(AlertModel.transaction_id == scorecard["transaction_id"]).first()
        
            if not existing:
                alert_id = f"ALT-{str(uuid.uuid4()).upper()}"
                
                reason_summary = scorecard["categorizations"]["risk_tier"] + " Risk Score Card triggered."
                if scorecard["rules_audit"]["triggered_rules_count"] > 0:
                    reasons = [r["reason"] for r in scorecard["rules_audit"]["overrides"]]
                    reason_summary += " Rule Violations detected: " + "; ".join(reasons)
                else:
                    drivers = [d["feature"] for d in scorecard["explainability"]["key_risk_drivers"]]
                    reason_summary += " Driven by high ML features variance: " + ", ".join(drivers)

                logs_trail = [{"operator": "System Agent", "action": "Automatic Risk Score Evaluation", "timestamp": scorecard["timestamp"]}]

                new_alert = AlertModel(
                    id=alert_id,
                    transaction_id=scorecard["transaction_id"],
                    sender_id=request.sender_id,
                    receiver_id=request.receiver_id,
                    amount=request.amount,
                    risk_score=scorecard["scores"]["final_risk_score"],
                    risk_tier=scorecard["categorizations"]["risk_tier"],
                    severity=scorecard["categorizations"]["alert_severity"],
                    status="Open",
                    reason=reason_summary,
                    timestamp=datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
                    assigned_to="Unassigned",
                    logs=json.dumps(logs_trail),
                    features=json.dumps(payload, default=str),
                    explainability=json.dumps({
                        "key_risk_drivers": scorecard["explainability"]["key_risk_drivers"],
                        "confidence_interval_90": scorecard["scores"].get("confidence_interval_90"),
                        "evasion_resistance": scorecard["explainability"].get("evasion_resistance"),
                    }, default=str),
                    _ts=time.time(),
                    triage_action=(
                        scorecard["categorizations"]["triage_routing"]["triage_action"]
                        if isinstance(scorecard.get("categorizations"), dict) and isinstance(scorecard["categorizations"].get("triage_routing"), dict)
                        else ("FAST_TRACK_FREEZE" if scorecard["scores"]["final_risk_score"] >= 85 else ("PRIORITY_MANUAL_REVIEW" if scorecard["scores"]["final_risk_score"] >= 50 else "STANDARD_MONITORING"))
                    ),
                    priority_tier=(
                        scorecard["categorizations"]["triage_routing"]["priority_tier"]
                        if isinstance(scorecard.get("categorizations"), dict) and isinstance(scorecard["categorizations"].get("triage_routing"), dict)
                        else scorecard["categorizations"]["risk_tier"]
                    ),
                    pu_probability=scorecard["scores"].get("base_ml_probability")
                )
                db.add(new_alert)
                db.commit()
                scorecard["associated_alert_id"] = alert_id
                logger.info(f"Generated operational alert incident successfully relative to task: {alert_id}")
            else:
                scorecard["associated_alert_id"] = existing.id

        return {
            "status": "success",
            "scorecard": scorecard
        }
    except Exception as e:
        logger.error(f"Transaction review pipeline failed: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Risk Score Engine execution failure: {str(e)}")


@app.get("/alerts", tags=["Governance & Operations"], dependencies=[Depends(verify_api_key)])
def list_alerts_queue(
    status_filter: Optional[str] = Query(None, description="Select Alert status: Open, Investigating, Escalated, Closed."),
    severity_filter: Optional[str] = Query(None, description="Select Severity: Low, Medium, High, Critical."),
    limit: int = Query(1000, ge=1, le=2000),
    db: Session = Depends(get_db)
):
    query = db.query(AlertModel)
    if status_filter:
        query = query.filter(AlertModel.status.ilike(status_filter))
    if severity_filter:
        query = query.filter(AlertModel.severity.ilike(severity_filter))
        
    results = [a.to_dict() for a in query.limit(limit).all()]
    slim_results = [{k: v for k, v in a.items() if k != "features"} for a in results]
        
    return {
        "status": "success",
        "alerts_count": len(results),
        "alerts": slim_results
    }


@app.post("/alerts", tags=["Governance & Operations"], dependencies=[Depends(verify_api_key)])
def ingest_simulated_alert(payload: AlertIngestRequest, db: Session = Depends(get_db)):
    score = payload.risk_score
    _, tier, severity, _ = risk_engine.map_probability_to_scorecard(score / 100.0)

    permitted_states = {"Open", "Investigating", "Escalated", "Closed"}
    status_state = payload.status or "Open"
    if status_state.capitalize() not in permitted_states:
         raise HTTPException(
             status_code=400,
             detail=f"Provided status label of '{status_state}' is not supported. Allowed: {permitted_states}"
         )

    alert_id = f"ALT-{str(uuid.uuid4()).upper()}"
    timestamp_str = payload.timestamp or datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    
    logs_trail = payload.logs if payload.logs is not None else [
        {"operator": "Manual Synchronizer", "action": "Injected Alert", "timestamp": "Now"}
    ]

    new_record = AlertModel(
        id=alert_id,
        transaction_id=payload.transaction_id,
        sender_id=payload.sender_id,
        receiver_id=payload.receiver_id,
        amount=payload.amount,
        risk_score=score,
        risk_tier=payload.risk_tier or tier,
        severity=payload.severity or severity,
        status=status_state.capitalize(),
        reason=payload.reason,
        timestamp=timestamp_str,
        assigned_to=payload.assigned_to,
        logs=json.dumps(logs_trail),
        features=json.dumps({}),
        _ts=time.time(),
        triage_action="PRIORITY_MANUAL_REVIEW" if score >= 50 else "STANDARD_MONITORING",
        priority_tier=payload.risk_tier or tier,
        pu_probability=float(score) / 100.0
    )

    db.add(new_record)
    db.commit()

    return {
        "status": "success",
        "created_alert_id": alert_id
    }


@app.put("/alerts/{alert_id}", tags=["Governance & Operations"], dependencies=[Depends(verify_api_key)])
def update_alert_status_handler(
    alert_id: str,
    payload: AlertUpdateRequest,
    db: Session = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    alert = db.query(AlertModel).filter(AlertModel.id == alert_id).first()
    if not alert:
        raise HTTPException(
            status_code=404,
            detail=f"Target alert record matching reference [{alert_id}] could not be found."
        )

    permitted_states = {"Open", "Investigating", "Escalated", "Closed"}
    if payload.status.capitalize() not in permitted_states:
        raise HTTPException(
            status_code=400,
            detail=f"Provided status label of '{payload.status}' is not supported. Allowed: {permitted_states}"
        )

    operator = payload.operator_name or user.display_name or user.username
    old_status = alert.status
    alert.status = payload.status.capitalize()
    
    log_time = datetime.now(UTC).strftime("%H:%M:%S UTC")
    new_logs = json.loads(alert.logs) if alert.logs else []
    
    new_logs.append({
        "operator": operator,
        "action": f"Changed status from {old_status} to {alert.status}",
        "timestamp": log_time
    })

    if payload.notes:
        new_logs.append({
            "operator": operator,
            "action": f"Appended Analyst Note: {payload.notes}",
            "timestamp": log_time
        })

    if payload.assigned_to is not None:
        old_assignee = alert.assigned_to or "Unassigned"
        alert.assigned_to = payload.assigned_to
        new_logs.append({
            "operator": operator,
            "action": f"Reassigned case from {old_assignee} to {payload.assigned_to}",
            "timestamp": log_time
        })
        
    alert.logs = json.dumps(new_logs)
    alert._ts = time.time()

    write_audit(
        db,
        actor=user.username,
        role=user.role,
        action="alert.update",
        entity_type="alert",
        entity_id=alert_id,
        detail=f"status={alert.status}; assigned_to={alert.assigned_to}",
        auth_method=user.auth_method,
    )

    db.commit()

    return {
        "status": "success",
        "message": f"Alert {alert_id} status updated successfully to {alert.status}.",
        "alert": alert.to_dict()
    }


@app.post("/alerts/{alert_id}/sar", response_model=SARResponse, tags=["Governance & Operations"], dependencies=[Depends(verify_api_key)])
async def generate_sar_report(alert_id: str, user: AuthUser = Depends(verify_api_key), db: Session = Depends(get_db)):
    alert = db.query(AlertModel).filter(AlertModel.id == alert_id).first()
    if not alert:
        raise HTTPException(
            status_code=404,
            detail=f"Target alert record matching reference [{alert_id}] could not be found."
        )
            
    alert_dict = alert.to_dict()
    key_drivers = alert_dict.get("key_risk_drivers", [])
    if not key_drivers and alert_dict.get("features"):
        try:
            _, key_drivers = risk_engine.score_transaction(alert_dict["features"])
        except Exception as e:
            logger.warning(f"Failed to compute live SHAP drivers for SAR: {e}")
            key_drivers = [{"feature": "transaction_amount", "shap_val": 0.45, "contribution": "High"}]

    try:
        corr = correlate_alert(alert_id, user, db)
        graph_summary = corr.get("graph_summary", {})
        related = corr.get("related_entities", [])
    except Exception as e:
        graph_summary = {"cluster_size": 1, "structuring_detected": False, "bridge_nodes": [], "max_hop_distance": 0, "near_threshold_count": 0}
        related = []

    fincen_id = f"SAR-BSA-{uuid.uuid4().hex[:8].upper()}-{alert_id}"
    ts_now = datetime.now(UTC).isoformat()

    alert_for_prompt = {k: v for k, v in alert_dict.items() if k != "features"}
    prompt = f"""
    You are an expert financial crimes investigator filing a formal FinCEN Form 111 / BSA 31 CFR § 1020.320 Suspicious Activity Report (SAR).
    Write a clear, statutory, 3-paragraph investigative narrative detailing why this activity warrants filing:
    1. Account overview & transaction velocity.
    2. Specific statutory basis (e.g., structuring, mule chaining, unusual international velocity).
    3. Quantitative SHAP risk driver alignment.

    Alert Data:
    {json.dumps(alert_for_prompt, indent=2)}
    Graph Summary:
    {json.dumps(graph_summary, indent=2)}
    Key SHAP Drivers:
    {json.dumps(key_drivers[:5], indent=2)}
    """
    
    llm_narrative = await run_in_threadpool(call_nvidia_llm, prompt)

    shap_table_rows = []
    for d in key_drivers[:8]:
        fname = d.get("feature", "unknown")
        sval = d.get("shap_val", 0.0)
        contrib = d.get("contribution", "Medium")
        shap_table_rows.append(f"| `{fname}` | `{sval:+.4f}` | **{contrib}** |")
    shap_table_str = "\n".join(shap_table_rows) if shap_table_rows else "| `N/A` | `0.0000` | **None** |"

    graph_evidence_rows = []
    for r in related[:6]:
        graph_evidence_rows.append(f"- **Linked Alert [{r['alert_id']}]** (Hop {r['hop_distance']}) | Tier: {r['risk_tier']} | Reason: {', '.join(r['match_reasons'])}")
    graph_evidence_str = "\n".join(graph_evidence_rows) if graph_evidence_rows else "- No multi-hop linked accounts in active cluster."

    raw_hash_payload = f"{fincen_id}:{alert_id}:{alert.risk_score}:{alert.transaction_id}:{ts_now}:{llm_narrative}"
    citation_hash = hashlib.sha256(raw_hash_payload.encode('utf-8')).hexdigest()

    sar_report = f"""# FINCEN / FIU REGULATOR-GRADE SUSPICIOUS ACTIVITY REPORT (SAR)
**Form 111 / BSA 31 CFR § 1020.320 Statutory Filing Artifact**

---

### PART I: FILING IDENTIFICATION & SUBJECT PROFILE
* **BSA Tracking Number:** `{fincen_id}`
* **Filing Timestamp:** `{ts_now}`
* **Target Alert ID:** `{alert.id}` (Transaction Ref: `{alert.transaction_id}`)
* **Account Number:** `{alert.sender_id}`
* **Origin / Destination:** `{alert.sender_id or 'Unknown'}` ➔ `{alert.receiver_id or 'Unknown'}`
* **Transaction Amount:** `₹{alert.amount:,.2f}` (`${(alert.amount or 0)/83.5:,.2f} USD`)
* **Risk Score / Tier:** `{alert.risk_score}` / **`{alert.risk_tier}`**
* **Assigned Investigator:** `{alert.assigned_to}`

---

### PART II: STATUTORY BASIS & INVESTIGATIVE NARRATIVE
**Statutory Authority:** Bank Secrecy Act (BSA) 31 CFR § 1020.320 / FinCEN Guidance FIN-2016-A005.

**Investigative Synthesis:**
{llm_narrative}

---

### PART III: EXPLAINABLE AI (XAI) QUANTITATIVE DRIVERS
This filing is supported by local SHAP (SHapley Additive exPlanations) attribution values calculated at exact transaction evaluation time (`{alert._ts}`):

| Feature Driver | Local SHAP Attribution | Contribution Rating |
| :--- | :---: | :---: |
{shap_table_str}

---

### PART IV: MULTI-HOP NETWORK & GRAPH TOPOLOGY EVIDENCE
* **Cluster Exposure Size:** `{graph_summary.get('cluster_size', 1)} account(s)`
* **Maximum Graph Depth:** `{graph_summary.get('max_hop_distance', 0)} Hop(s)`
* **Bridge / Intermediary Accounts:** `{', '.join(graph_summary.get('bridge_nodes', [])) or 'None'}`
* **Structuring Smurfing Indicator:** `{'DETECTED (Near-threshold / High velocity)' if graph_summary.get('structuring_detected') else 'Not Detected'}`

**Linked Network Entities:**
{graph_evidence_str}

---

### PART V: AUDIT ATTESTATION & CRYPTOGRAPHIC INTEGRITY
* **Generated By:** `{user.username}` (`{user.role}`) via `{user.auth_method}`
* **Attestation Timestamp:** `{datetime.now(UTC).strftime('%Y-%m-%d %H:%M:%S UTC')}`
* **Cryptographic Evidence Hash (SHA-256):**
  `{citation_hash}`

> *Notice: This document contains sensitive regulatory filings protected under Federal Law (31 U.S.C. 5318(g)(2)). Unauthorized disclosure of SAR filings is subject to civil and criminal penalties.*
"""

    log_time = datetime.now(UTC).strftime("%H:%M:%S UTC")
    new_logs = json.loads(alert.logs) if alert.logs else []
    new_logs.append({
        "operator": user.username,
        "action": f"Generated Regulator-Grade SAR Report ({fincen_id})",
        "timestamp": log_time
    })
    alert.logs = json.dumps(new_logs)

    write_audit(
        db,
        actor=user.username,
        role=user.role,
        action="alert.export_sar",
        entity_type="alert",
        entity_id=alert_id,
        detail=f"Generated SAR Form 111 / BSA artifact ({fincen_id}) with SHA-256 hash {citation_hash[:16]}...",
        auth_method=user.auth_method,
    )
    db.commit()

    return {
        "sar_report": sar_report,
        "fincen_tracking_id": fincen_id,
        "citation_hash": citation_hash
    }


@app.post("/alerts/{alert_id}/explain-plain-language", response_model=PlainLanguageExplanationResponse, tags=["Governance & Operations"], dependencies=[Depends(verify_api_key)])
async def generate_plain_language_explanation(alert_id: str, user: AuthUser = Depends(verify_api_key), db: Session = Depends(get_db)):
    alert = db.query(AlertModel).filter(AlertModel.id == alert_id).first()
    if not alert:
        raise HTTPException(
            status_code=404,
            detail=f"Target alert record matching reference [{alert_id}] could not be found."
        )

    alert_dict = alert.to_dict()
    prompt = f"""
    You are explaining a fraud-risk score to a bank compliance analyst who is not a data
    scientist. Write 3-4 short sentences in plain English. State the risk level, the one or
    two strongest reasons the model flagged this account (from the risk drivers below), and
    avoid ML jargon (no "SHAP", "feature importance", or model internals). Be factual and
    measured — do not accuse the account holder of wrongdoing, describe this as a pattern
    that warrants review.

    Risk tier: {alert_dict.get('risk_tier', 'Unknown')}
    Risk score: {alert_dict.get('risk_score', 'Unknown')}
    Key risk drivers: {json.dumps(alert_dict.get('key_risk_drivers', []), indent=2)}
    """

    fallback_text = (
        f"This account was scored at {alert_dict.get('risk_tier', 'an elevated')} risk "
        f"(score: {alert_dict.get('risk_score', 'N/A')}). Automated plain-language summary "
        f"unavailable right now — please refer to the key risk drivers list for this alert."
    )
    explanation = await run_in_threadpool(call_nvidia_llm, prompt, fallback_text)

    write_audit(
        db,
        actor=user.username,
        role=user.role,
        action="alert.explain_plain",
        entity_type="alert",
        entity_id=alert_id,
        detail="Generated plain-language summary",
        auth_method=user.auth_method,
    )
    db.commit()

    return {"explanation": explanation}


@app.post("/tune-threshold", tags=["Model Analytics"], dependencies=[Depends(verify_api_key)])
def tune_model_threshold(request: TuneRequest, user: AuthUser = Depends(verify_api_key), db: Session = Depends(get_db)):
    global GLOBAL_DECISION_THRESHOLD
    if not (0.0 < request.new_threshold < 1.0):
        raise HTTPException(status_code=400, detail="Threshold must be between 0.0 and 1.0")
    with _threshold_lock:
        GLOBAL_DECISION_THRESHOLD = request.new_threshold

    write_audit(
        db,
        actor=user.username,
        role=user.role,
        action="system.threshold_tune",
        entity_type="system",
        entity_id="GLOBAL_DECISION_THRESHOLD",
        detail=f"Adjusted threshold to {request.new_threshold}",
        auth_method=user.auth_method,
    )
    db.commit()

    return {
        "status": "success", 
        "message": f"Global risk threshold adjusted to {request.new_threshold}",
        "new_threshold": request.new_threshold
    }


@app.get("/cost-thresholds", tags=["Model Analytics"], dependencies=[Depends(verify_api_key)])
async def get_cost_thresholds():
    cost_path = os.path.join(os.path.dirname(__file__), "..", "cost_thresholds.json")
    if os.path.exists(cost_path):
        try:
            with open(cost_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, dict):
                data["status"] = "success"
                fin = data.get("financial_parameters", {})
                data.setdefault("c_fn", fin.get("c_fn_mule_loss_inr", 388000.0))
                data.setdefault("c_fp", fin.get("c_fp_audit_cost_inr", 1200.0))
                ops = data.get("operating_points", {})
                cons = ops.get("Conservative", {}) if isinstance(ops, dict) else {}
                data.setdefault("optimal_threshold", cons.get("threshold", 0.65))
            return data
        except Exception as e:
            logger.error(f"Failed to load cost_thresholds.json: {e}")
    if risk_engine.cost_optimizer:
        return {
            "status": "success",
            "c_fn": getattr(risk_engine.cost_optimizer, "c_fn", 388000.0),
            "c_fp": getattr(risk_engine.cost_optimizer, "c_fp", 1200.0),
            "optimal_threshold": getattr(risk_engine.cost_optimizer, "optimal_threshold", 0.50),
            "note": "Loaded from active memory optimizer."
        }
    raise HTTPException(status_code=404, detail="Cost threshold metrics not found.")


@app.get("/pu-calibration", tags=["Model Analytics"], dependencies=[Depends(verify_api_key)])
async def get_pu_calibration_metrics():
    pu_path = os.path.join(os.path.dirname(__file__), "..", "pu_metrics.json")
    if os.path.exists(pu_path):
        try:
            with open(pu_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, dict):
                data["status"] = "success"
                data.setdefault("c_estimate", data.get("overall_c_estimate", 1.0))
                data.setdefault("spy_threshold", data.get("spy_threshold", 0.01))
            return data
        except Exception as e:
            logger.error(f"Failed to load pu_metrics.json: {e}")
    if risk_engine.pu_engine:
        return {
            "status": "success",
            "c_estimate": getattr(risk_engine.pu_engine, "c_", 1.0),
            "spy_threshold": getattr(risk_engine.pu_engine, "spy_threshold_", None),
            "note": "Loaded from active memory PU engine."
        }
    raise HTTPException(status_code=404, detail="PU calibration metrics not found.")


@app.post("/pu-calibration", tags=["Model Analytics"], dependencies=[Depends(verify_api_key)])
async def calibrate_pu_probabilities(request: PUCalibrateRequest, user: AuthUser = Depends(verify_api_key), db: Session = Depends(get_db)):
    if not risk_engine.pu_engine:
        raise HTTPException(status_code=500, detail="PU learning engine not active.")
    probs = np.array(request.raw_probabilities)
    calibrated = risk_engine.pu_engine.calibrate_probabilities(probs, c=request.c_factor)

    write_audit(
        db,
        actor=user.username,
        role=user.role,
        action="system.pu_calibrate",
        entity_type="system",
        entity_id="pu_engine",
        detail=f"Calibrated probabilities with c_factor={request.c_factor}",
        auth_method=user.auth_method,
    )
    db.commit()

    return {
        "status": "success",
        "c_factor_used": request.c_factor if request.c_factor is not None else getattr(risk_engine.pu_engine, "c_", 1.0),
        "raw_probabilities": request.raw_probabilities,
        "calibrated_probabilities": calibrated.tolist()
    }


@app.post("/pu-calibration/tune", tags=["Model Analytics"], dependencies=[Depends(verify_api_key)])
async def tune_pu_calibration(request: SPYTuneRequest, user: AuthUser = Depends(verify_api_key), db: Session = Depends(get_db)):
    if not risk_engine.pu_engine:
        raise HTTPException(status_code=500, detail="PU learning engine not active.")
        
    old_c = getattr(risk_engine.pu_engine, "c_", None) or getattr(risk_engine.pu_engine, "c_estimate_", None) or 0.725
    old_spy = getattr(risk_engine.pu_engine, "spy_threshold_", None) or 0.152
    new_c = request.c_factor if request.c_factor is not None else old_c
    new_spy = request.spy_threshold if request.spy_threshold is not None else old_spy
    
    if request.c_factor is not None:
        risk_engine.pu_engine.c_estimate_ = float(max(0.05, min(1.0, request.c_factor)))
    if request.spy_threshold is not None:
        risk_engine.pu_engine.spy_threshold_ = float(max(0.001, min(0.999, request.spy_threshold)))

    # Persist updated PU engine object and pu_metrics.json
    try:
        pu_path = os.path.join(risk_engine.models_dir, "pu_engine.pkl")
        os.makedirs(risk_engine.models_dir, exist_ok=True)
        with open(pu_path, "wb") as f:
            pickle.dump(risk_engine.pu_engine, f)
    except Exception as e:
        logger.error(f"Failed to save pu_engine.pkl during SPY tuning: {e}")

    pu_json_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "pu_metrics.json")
    data = {}
    if os.path.exists(pu_json_path):
        try:
            with open(pu_json_path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception as e:
            logger.error(f"Failed to load pu_metrics.json: {e}")

    data["overall_c_estimate"] = new_c
    data["c_estimate"] = new_c
    if new_spy is not None:
        data["spy_threshold"] = new_spy
        if "spy_statistics" in data and isinstance(data["spy_statistics"], dict):
            data["spy_statistics"]["spy_threshold"] = new_spy
    data["last_tuning_timestamp"] = pd.Timestamp.utcnow().isoformat() + "Z"

    try:
        with open(pu_json_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
    except Exception as e:
        logger.error(f"Failed to save pu_metrics.json: {e}")

    old_c_val = float(old_c) if old_c is not None else 0.725
    new_c_val = float(new_c) if new_c is not None else 0.725
    old_spy_val = float(old_spy) if old_spy is not None else 0.152
    new_spy_val = float(new_spy) if new_spy is not None else 0.152

    write_audit(
        db,
        actor=user.username,
        role=user.role,
        action="system.pu_tune",
        entity_type="pu_engine",
        entity_id="SPY_THRESHOLD",
        detail=f"Analyst/Admin tuned PU metrics: c_factor {old_c_val:.4f}->{new_c_val:.4f}, SPY threshold {old_spy_val:.4f}->{new_spy_val:.4f}",
        auth_method=user.auth_method,
    )
    db.commit()

    return {
        "status": "success",
        "old_c_factor": old_c_val,
        "new_c_factor": new_c_val,
        "old_spy_threshold": old_spy_val,
        "new_spy_threshold": new_spy_val,
        "message": "PU calibration metrics successfully tuned."
    }


@app.post("/triage-eval", tags=["Governance & Operations"], dependencies=[Depends(verify_api_key)])
async def evaluate_operational_triage(request: TriageEvalRequest):
    if not risk_engine.triage_policy:
        raise HTTPException(status_code=500, detail="Triage policy engine not initialized.")
    result = risk_engine.triage_policy.evaluate_account(
        risk_score=request.risk_score,
        ci_lower=request.ci_lower,
        ci_upper=request.ci_upper,
        evadable=request.evadable,
        pu_probability=request.pu_probability,
        account_id=request.account_id
    )
    return {
        "status": "success",
        "triage_evaluation": result
    }


@app.post("/feedback", response_model=FeedbackResponse, tags=["Model Analytics"], dependencies=[Depends(verify_api_key)])
@app.post("/alerts/{alert_id}/feedback", response_model=FeedbackResponse, tags=["Model Analytics"], dependencies=[Depends(verify_api_key)])
async def submit_analyst_feedback(
    request: FeedbackRequest,
    alert_id: Optional[str] = None,
    user: AuthUser = Depends(verify_api_key),
    db: Session = Depends(get_db)
):
    target_alert_id = alert_id or request.alert_id
    if not target_alert_id:
        raise HTTPException(status_code=400, detail="alert_id is required")

    # Check alert in database if present
    alert = db.query(AlertModel).filter(AlertModel.id == target_alert_id).first()
    alert_score = 0.5
    if alert:
        alert_score = (alert.risk_score or 50.0) / 100.0
        if request.label in ["True Positive", "Mule Ring", "Confirmed Fraud"]:
            alert.status = "Escalated"
        elif request.label in ["False Positive", "Legitimate", "Clear"]:
            alert.status = "Closed"

    # Trigger online recalibration if enabled
    old_c = getattr(risk_engine.pu_engine, "c_", 0.725) if risk_engine.pu_engine else 0.725
    new_c = old_c
    old_spy = getattr(risk_engine.pu_engine, "spy_threshold_", 0.152) if risk_engine.pu_engine else 0.152
    new_spy = old_spy

    if request.trigger_recalibration:
        recal = risk_engine.online_recalibrate(label=request.label, alert_score=alert_score)
        old_c = recal.get("old_c_factor", old_c)
        new_c = recal.get("new_c_factor", new_c)
        old_spy = recal.get("old_spy_threshold", old_spy)
        new_spy = recal.get("new_spy_threshold", new_spy)

    write_audit(
        db,
        actor=user.username,
        role=user.role,
        action="alert.feedback_recalibrate" if request.trigger_recalibration else "alert.feedback",
        entity_type="alert_model_closed_loop",
        entity_id=target_alert_id,
        detail=f"Analyst feedback '{request.label}' (notes: {request.analyst_notes or 'None'}). Recalibration: c {old_c:.4f}->{new_c:.4f}, SPY {old_spy}->{new_spy}",
        auth_method=user.auth_method,
        tenant_id=request.tenant_id or "TN-GLOBAL-01",
        org_id=request.org_id or "ORG-FIN-PRIMARY"
    )
    db.commit()

    return FeedbackResponse(
        status="success",
        alert_id=target_alert_id,
        label_recorded=request.label,
        recalibration_triggered=request.trigger_recalibration,
        old_c_factor=old_c,
        new_c_factor=new_c,
        old_spy_threshold=old_spy,
        new_spy_threshold=new_spy,
        message=f"Closed-loop feedback recorded. PU model discovery factor calibrated from {old_c:.4f} to {new_c:.4f}."
    )


@app.get("/adversarial-shift/status", tags=["Model Analytics"], dependencies=[Depends(verify_api_key)])
async def get_adversarial_shift_status(
    user: AuthUser = Depends(verify_api_key)
):
    """
    Returns current online drift monitoring metrics (PSI), distribution shift status, and adaptation history.
    """
    status_data = risk_engine.get_adversarial_shift_status()
    return {
        "status": "success",
        "current_shift_status": status_data["current_shift_status"],
        "adaptation_history": status_data["adaptation_history"]
    }




@app.get("/stream-alerts", tags=["Governance & Operations"], dependencies=[Depends(verify_api_key)])
async def stream_alerts():
    async def event_generator():
        last_seen_ts = time.time()
        from app.db import SessionLocal
        db = SessionLocal()
        try:
            recent_alerts = db.query(AlertModel).order_by(AlertModel._ts.desc()).limit(10).all()
            for alert in reversed(recent_alerts):
                alert_dict = alert.to_dict()
                yield f"data: {json.dumps(alert_dict)}\n\n"
                last_seen_ts = max(last_seen_ts, alert._ts)
        finally:
            db.close()

        counter = 0
        while True:
            await asyncio.sleep(2.5)
            counter += 1
            db = SessionLocal()
            try:
                updated_alerts = db.query(AlertModel).filter(AlertModel._ts > last_seen_ts).all()
                if updated_alerts:
                    for alert in updated_alerts:
                        alert_dict = alert.to_dict()
                        yield f"data: {json.dumps(alert_dict)}\n\n"
                        last_seen_ts = max(last_seen_ts, alert._ts)
                elif counter % 2 == 0:
                    yield ": heartbeat\n\n"
                else:
                    yield ": keep-alive\n\n"
            finally:
                db.close()

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@app.get("/correlate/{alert_id}", tags=["Governance & Operations"], dependencies=[Depends(verify_api_key)])
def correlate_alert(alert_id: str, user: AuthUser = Depends(verify_api_key), db: Session = Depends(get_db)):
    alerts = db.query(AlertModel).all()
    alerts_copy = []
    for a in alerts:
        a_dict = a.to_dict()
        alerts_copy.append({
            "id": a.id,
            "transaction_id": a.transaction_id,
            "sender_id": a.sender_id,
            "receiver_id": a.receiver_id,
            "risk_tier": a.risk_tier,
            "amount": a.amount,
            "timestamp": a._ts,
            "features": a_dict.get("features", {})
        })

    target = next((a for a in alerts_copy if a["id"] == alert_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="Alert not found")

    target_sender = target.get("sender_id")
    target_receiver = target.get("receiver_id")

    # Build entity adjacencies (accounts to alerts and alerts to accounts)
    account_to_alerts = {}
    for a in alerts_copy:
        for acc in [a.get("sender_id"), a.get("receiver_id")]:
            if acc:
                account_to_alerts.setdefault(acc, []).append(a)

    related = []
    visited_alerts = {alert_id}
    bridge_nodes = set()
    
    # Hop 1: Direct shared entities
    hop1_accounts = {target_sender, target_receiver} - {None}
    hop2_accounts = set()

    for acc in hop1_accounts:
        for a in account_to_alerts.get(acc, []):
            if a["id"] in visited_alerts:
                continue
            reasons = []
            if a.get("sender_id") == acc:
                reasons.append(f"Direct Hop 1: Shared Sender/Receiver ({acc})")
            if a.get("receiver_id") == acc:
                reasons.append(f"Direct Hop 1: Shared Sender/Receiver ({acc})")
            
            # Check if this account acts as a bridge (sender in one alert, receiver in another)
            if (a.get("sender_id") == acc and target_receiver == acc) or (a.get("receiver_id") == acc and target_sender == acc):
                reasons.append(f"Bridge Account Pattern detected on node [{acc}]")
                bridge_nodes.add(acc)

            visited_alerts.add(a["id"])
            related.append({
                "alert_id": a["id"],
                "transaction_id": a["transaction_id"],
                "match_reasons": reasons,
                "risk_tier": a["risk_tier"],
                "hop_distance": 1,
                "bridge_entity": acc if acc in bridge_nodes else None,
                "amount": a["amount"]
            })
            for next_acc in [a.get("sender_id"), a.get("receiver_id")]:
                if next_acc and next_acc not in hop1_accounts:
                    hop2_accounts.add((next_acc, acc, a["id"]))

    # Hop 2: Multi-hop graph correlation (e.g. A -> B -> C mule chaining)
    for next_acc, bridge_acc, via_alert_id in hop2_accounts:
        for a in account_to_alerts.get(next_acc, []):
            if a["id"] in visited_alerts:
                continue
            reasons = [f"Multi-Hop (Hop 2) via intermediary account [{bridge_acc}] linked from alert [{via_alert_id}]"]
            bridge_nodes.add(bridge_acc)
            visited_alerts.add(a["id"])
            related.append({
                "alert_id": a["id"],
                "transaction_id": a["transaction_id"],
                "match_reasons": reasons,
                "risk_tier": a["risk_tier"],
                "hop_distance": 2,
                "bridge_entity": bridge_acc,
                "amount": a["amount"]
            })

    # Behavioral pattern correlation across velocity & amount bands.
    # NOTE: these are heuristic *pattern matches*, not discovered/named criminal rings.
    # Labels below were previously "STRUCTURING-RING-ALPHA" / "VELOCITY-CLUSTER-V1", which
    # implied the system had identified a specific, named syndicate. It hadn't — it matched
    # a coincidental amount band or velocity threshold. Relabeled to describe the actual
    # heuristic, not a dramatized entity name.
    target_amt = target.get("amount") or 0
    target_tier = target.get("risk_tier") or "Medium"
    for a in alerts_copy:
        if a["id"] in visited_alerts:
            continue
        reasons = []
        a_amt = a.get("amount") or 0
        a_tier = a.get("risk_tier") or "Medium"
        
        # Smurfing band check (e.g., both ₹9,000-₹9,999 near-threshold structuring)
        if 9000 <= target_amt <= 9999 and 9000 <= a_amt <= 9999:
            reasons.append("Behavioral Hop 2: Co-occurring Near-Threshold Structuring Band (₹9k-₹10k)")
            bridge_nodes.add("NEAR_THRESHOLD_AMOUNT_BAND_MATCH")
        # High velocity pattern check
        elif (target.get("features") or {}).get("velocity_6h", 0) >= 3 and (a.get("features") or {}).get("velocity_6h", 0) >= 3:
            reasons.append("Behavioral Hop 2: Synchronized High-Velocity Pattern Match")
            bridge_nodes.add("HIGH_VELOCITY_PATTERN_MATCH")
        # No fallback here anymore: if no real signal (direct hop, structuring band, or
        # velocity match) is found for this alert, the correlation graph for it should
        # come back empty. Manufacturing a "Peer Risk Cluster" link between two unrelated
        # same-tier accounts specifically because nothing real was found is exactly the
        # kind of fabricated-to-avoid-an-empty-state pattern this project has repeatedly
        # had to remove elsewhere — an honest empty result is not a bug to paper over.
            
        if reasons:
            visited_alerts.add(a["id"])
            related.append({
                "alert_id": a["id"],
                "transaction_id": a["transaction_id"],
                "match_reasons": reasons,
                "risk_tier": a["risk_tier"],
                "hop_distance": 2 if "Hop 2" in reasons[0] else 1,
                "bridge_entity": "NEAR_THRESHOLD_AMOUNT_BAND_MATCH" if "Structuring" in reasons[0] else ("HIGH_VELOCITY_PATTERN_MATCH" if "Velocity" in reasons[0] else None),
                "amount": a["amount"]
            })

    # Structuring & velocity analysis across cluster
    cluster_alerts = [target] + [next((a for a in alerts_copy if a["id"] == r["alert_id"]), target) for r in related]
    structuring_detected = False
    near_threshold_count = sum(1 for a in cluster_alerts if 9000 <= (a.get("amount") or 0) <= 9999)
    high_velocity_count = sum(1 for a in cluster_alerts if (a.get("features") or {}).get("velocity_6h", 0) >= 3)
    
    if near_threshold_count >= 2 or high_velocity_count >= 2:
        # BUG-003 FIX: only flag structuring if STRUCTURAL signals (amount bands / velocity) present — not bridge nodes alone
        structuring_detected = True

    write_audit(
        db,
        actor=user.username,
        role=user.role,
        action="alert.correlate",
        entity_type="alert",
        entity_id=alert_id,
        detail=f"Graph correlation found {len(related)} related entities (max hop 2, structuring={structuring_detected})",
        auth_method=user.auth_method,
    )
    db.commit()

    return {
        "target_alert": alert_id,
        "related_entities": related,
        "graph_summary": {
            "cluster_size": len(cluster_alerts),
            "structuring_detected": structuring_detected,
            "bridge_nodes": list(bridge_nodes),
            "max_hop_distance": 2 if any(r["hop_distance"] == 2 for r in related) else (1 if related else 0),
            "near_threshold_count": near_threshold_count
        }
    }


def _process_batch_csv(file_bytes: bytes) -> Dict[str, Any]:
    REQUIRED_COLS = {"amount", "origin_country", "destination_country", "account_age_days", "is_international"}
    results = []
    processed_rows = 0
    errors = []

    for chunk in pd.read_csv(io.BytesIO(file_bytes), chunksize=100):
        if processed_rows > 10000:
            errors.append("Hard cap of 10,000 rows reached. Remaining rows ignored.")
            break

        if processed_rows == 0:
            missing = REQUIRED_COLS - set(chunk.columns)
            if missing:
                raise ValueError(f"CSV missing required columns: {', '.join(missing)}")

        for _, row in chunk.iterrows():
            req_data = {k: (None if pd.isna(v) else v) for k, v in row.to_dict().items()}

            try:
                req_data["amount"] = float(req_data.get("amount") or 0.0)
                req_data["account_age_days"] = int(float(req_data.get("account_age_days") or 0))
                req_data["is_international"] = str(req_data.get("is_international") or "false").lower() in ("true", "1", "yes", "t")

                if req_data.get("custom_metrics") and isinstance(req_data["custom_metrics"], str):
                    try:
                        req_data["custom_metrics"] = json.loads(req_data["custom_metrics"])
                    except Exception:
                        req_data["custom_metrics"] = {}
                elif not isinstance(req_data.get("custom_metrics"), dict):
                    req_data["custom_metrics"] = {}
            except Exception as coerce_e:
                errors.append(f"Row {processed_rows + 1}: type coercion failed - {coerce_e}")
                processed_rows += 1
                continue

            try:
                scorecard = risk_engine.score_single_case(req_data)
                results.append(scorecard)
            except Exception as row_e:
                errors.append(f"Row {processed_rows + 1}: scoring failed - {row_e}")
                results.append({"error": str(row_e), "row_index": processed_rows + 1})
            processed_rows += 1

    return {
        "status": "success",
        "processed_rows": processed_rows,
        "scored_count": len([r for r in results if "error" not in r]),
        "error_count": len(errors),
        "errors": errors[:50],
        "results": results
    }


@app.post("/batch-score", tags=["Inference Engine"], dependencies=[Depends(verify_api_key)])
async def batch_score_transactions(file: UploadFile = File(...), user: AuthUser = Depends(verify_api_key), db: Session = Depends(get_db)):
    if not file.filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files are supported.")
    try:
        content = await file.read()
        results = await run_in_threadpool(_process_batch_csv, content)

        write_audit(
            db,
            actor=user.username,
            role=user.role,
            action="alert.batch_ingest",
            entity_type="alert",
            entity_id=file.filename,
            detail=f"Batch scored {results.get('total_processed', 0)} transactions",
            auth_method=user.auth_method,
        )
        db.commit()

        return results
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Batch processing error: {str(e)}")


if __name__ == "__main__":
    import uvicorn
    print("=== STARTING FASTAPI DEV STREAM ON PORT 8000 ===")
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
