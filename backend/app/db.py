import os
import json
from typing import Optional
from sqlalchemy import create_engine, Column, String, Float, Integer, Text
from sqlalchemy.orm import declarative_base, sessionmaker
from datetime import datetime, UTC

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./fage_alerts.db")

if DATABASE_URL.startswith("sqlite"):
    engine = create_engine(
        DATABASE_URL, connect_args={"check_same_thread": False}
    )
else:
    # PostgreSQL / SQLAlchemy connection pooling for horizontal scalability
    engine = create_engine(
        DATABASE_URL,
        pool_pre_ping=True,
        pool_size=int(os.getenv("DB_POOL_SIZE", "10")),
        max_overflow=int(os.getenv("DB_MAX_OVERFLOW", "20"))
    )

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

class AlertModel(Base):
    __tablename__ = "alerts"

    id = Column(String, primary_key=True, index=True)
    transaction_id = Column(String, index=True)
    sender_id = Column(String)
    receiver_id = Column(String)
    amount = Column(Float)
    risk_score = Column(Integer)
    risk_tier = Column(String)
    severity = Column(String)
    status = Column(String, index=True)
    reason = Column(Text)
    timestamp = Column(String)
    assigned_to = Column(String)
    logs = Column(Text)  # Stored as JSON string
    features = Column(Text) # Stored as JSON string
    explainability = Column(Text)  # Stored as JSON string: key_risk_drivers, confidence_interval_90, evasion_resistance
    _ts = Column(Float)
    triage_action = Column(String, nullable=True)
    priority_tier = Column(String, nullable=True)
    pu_probability = Column(Float, nullable=True)
    tenant_id = Column(String, index=True, default="default")
    org_id = Column(String, index=True, default="FAGE-CORE")

    def to_dict(self):
        return {
            "id": self.id,
            "transaction_id": self.transaction_id,
            "sender_id": self.sender_id,
            "receiver_id": self.receiver_id,
            "amount": self.amount,
            "risk_score": self.risk_score,
            "risk_tier": self.risk_tier,
            "severity": self.severity,
            "status": self.status,
            "reason": self.reason,
            "timestamp": self.timestamp,
            "assigned_to": self.assigned_to,
            "logs": json.loads(self.logs) if self.logs else [],
            "features": json.loads(self.features) if self.features else {},
            "explainability": json.loads(self.explainability) if self.explainability else None,
            "_ts": self._ts,
            "triage_action": self.triage_action,
            "priority_tier": self.priority_tier,
            "pu_probability": self.pu_probability,
            "tenant_id": getattr(self, "tenant_id", "default"),
            "org_id": getattr(self, "org_id", "FAGE-CORE"),
        }


class AuditLogModel(Base):
    """Append-only governance audit trail (case + system events)."""
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    timestamp = Column(String, index=True, nullable=False)
    actor = Column(String, index=True, nullable=False)
    role = Column(String, nullable=True)
    action = Column(String, nullable=False)
    entity_type = Column(String, index=True, nullable=False)  # alert | auth | system
    entity_id = Column(String, index=True, nullable=True)
    detail = Column(Text, nullable=True)
    auth_method = Column(String, nullable=True)
    tenant_id = Column(String, index=True, default="default")
    org_id = Column(String, index=True, default="FAGE-CORE")

    def to_dict(self):
        return {
            "id": self.id,
            "timestamp": self.timestamp,
            "actor": self.actor,
            "role": self.role,
            "action": self.action,
            "entity_type": self.entity_type,
            "entity_id": self.entity_id,
            "detail": self.detail,
            "auth_method": self.auth_method,
            "tenant_id": getattr(self, "tenant_id", "default"),
            "org_id": getattr(self, "org_id", "FAGE-CORE"),
        }


def write_audit(
    db,
    *,
    actor: str,
    action: str,
    entity_type: str,
    entity_id: Optional[str] = None,
    detail: Optional[str] = None,
    role: Optional[str] = None,
    auth_method: Optional[str] = None,
    tenant_id: str = "default",
    org_id: str = "FAGE-CORE",
):
    entry = AuditLogModel(
        timestamp=datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        actor=actor,
        role=role,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        detail=detail,
        auth_method=auth_method,
        tenant_id=tenant_id,
        org_id=org_id,
    )
    db.add(entry)
    return entry


def ensure_schema_columns(engine_instance):
    """Ensure newly added schema columns exist when using SQLite fallback without full migrations."""
    if engine_instance.dialect.name == "sqlite":
        from sqlalchemy import text
        with engine_instance.connect() as conn:
            try:
                result = conn.execute(text("PRAGMA table_info(alerts)"))
                existing_cols = {row[1] for row in result.fetchall()}
                if "triage_action" not in existing_cols:
                    conn.execute(text("ALTER TABLE alerts ADD COLUMN triage_action VARCHAR"))
                if "priority_tier" not in existing_cols:
                    conn.execute(text("ALTER TABLE alerts ADD COLUMN priority_tier VARCHAR"))
                if "pu_probability" not in existing_cols:
                    conn.execute(text("ALTER TABLE alerts ADD COLUMN pu_probability FLOAT"))
                if "tenant_id" not in existing_cols:
                    conn.execute(text("ALTER TABLE alerts ADD COLUMN tenant_id VARCHAR DEFAULT 'default'"))
                if "org_id" not in existing_cols:
                    conn.execute(text("ALTER TABLE alerts ADD COLUMN org_id VARCHAR DEFAULT 'FAGE-CORE'"))
                conn.commit()
            except Exception:
                pass

            try:
                result = conn.execute(text("PRAGMA table_info(audit_logs)"))
                audit_cols = {row[1] for row in result.fetchall()}
                if "tenant_id" not in audit_cols:
                    conn.execute(text("ALTER TABLE audit_logs ADD COLUMN tenant_id VARCHAR DEFAULT 'default'"))
                if "org_id" not in audit_cols:
                    conn.execute(text("ALTER TABLE audit_logs ADD COLUMN org_id VARCHAR DEFAULT 'FAGE-CORE'"))
                conn.commit()
            except Exception:
                pass

Base.metadata.create_all(bind=engine)
ensure_schema_columns(engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

