import random
import uuid
import json
from datetime import datetime, timedelta, UTC
import sys
import os

# Ensure backend directory is in path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.db import SessionLocal, AlertModel

def seed_db():
    db = SessionLocal()
    
    existing = db.query(AlertModel).count()
    if existing > 0:
        print(f"Database already contains {existing} alerts. Skipping seed.")
        return
        
    print("Seeding database with realistic synthetic alerts...")
    
    statuses = ["Open", "Investigating", "Escalated", "Closed"]
    severities = ["Low", "Medium", "High", "Critical"]
    tiers = ["Tier 1", "Tier 2", "Tier 3"]
    
    alerts = []
    now = datetime.now(UTC)
    
    for i in range(150):
        alert_id = f"ALT-{str(uuid.uuid4()).upper()}"
        score = random.randint(10, 99)
        
        # Calculate tier based on score
        if score > 85:
            tier = "Tier 3"
            severity = "Critical"
        elif score > 65:
            tier = "Tier 2"
            severity = "High"
        elif score > 40:
            tier = "Tier 1"
            severity = "Medium"
        else:
            tier = "Tier 1"
            severity = "Low"
            
        status = random.choice(statuses)
        amount = round(random.uniform(50.0, 15000.0), 2)
        ts = now - timedelta(hours=random.randint(0, 168), minutes=random.randint(0, 60))
        
        # Some realistic reasons
        reasons = [
            "Unusual transfer volume.",
            "Cross-border transaction anomaly.",
            "Account age discrepancy.",
            "Structuring behavior detected.",
            "High velocity of transfers."
        ]
        
        new_record = AlertModel(
            id=alert_id,
            transaction_id=f"TXN-{random.randint(100000, 999999)}",
            sender_id=f"ACC-{random.randint(1000, 9999)}",
            receiver_id=f"ACC-{random.randint(1000, 9999)}",
            amount=amount,
            risk_score=score,
            risk_tier=tier,
            severity=severity,
            status=status,
            reason=random.choice(reasons),
            timestamp=ts.strftime("%Y-%m-%dT%H:%M:%SZ"),
            assigned_to="System Operator" if status != "Open" else "Unassigned",
            logs=json.dumps([{"operator": "System Agent", "action": "Automatic Risk Score Evaluation", "timestamp": ts.strftime("%Y-%m-%dT%H:%M:%SZ")}]),
            features=json.dumps({"account_age_days": random.randint(0, 365), "is_international": random.choice([True, False])}),
            explainability=json.dumps({"key_risk_drivers": [{"feature": "amount", "importance": 0.8}]}),
            _ts=ts.timestamp(),
            triage_action="Escalate" if score > 75 else "Review",
            priority_tier="High" if score > 75 else "Low",
            pu_probability=score / 100.0,
            tenant_id="default",
            org_id="FAGE-CORE",
        )
        alerts.append(new_record)
        
    db.add_all(alerts)
    db.commit()
    print(f"Successfully inserted {len(alerts)} alerts.")
    db.close()

if __name__ == "__main__":
    seed_db()
