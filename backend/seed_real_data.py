import os
import sys
import pandas as pd
import uuid
import json
from datetime import datetime, timedelta, UTC
import random

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.db import SessionLocal, AlertModel
from app.main import risk_engine

def seed_real_data():
    db = SessionLocal()
    
    print("Clearing synthetic alerts...")
    db.query(AlertModel).delete()
    db.commit()

    print("Loading actual dataset...")
    df = pd.read_csv("data/DataSet_cleaned.csv")
    
    # Optional: we can sample both frauds (F3924 == 1) and non-frauds so the dashboard sees both
    target_col = "F3924"
    if target_col not in df.columns:
        target_col = [c for c in df.columns if c.lower() == "f3924"][0]
        
    frauds = df[df[target_col] == 1].sample(min(20, (df[target_col] == 1).sum()), random_state=42)
    legits = df[df[target_col] == 0].sample(130, random_state=42)
    sample_df = pd.concat([frauds, legits]).sample(frac=1, random_state=42).reset_index(drop=True)
    
    print(f"Sampled {len(sample_df)} real rows. Generating scorecards & alerts...")
    
    now = datetime.now(UTC)
    alerts = []
    
    for i, row in sample_df.iterrows():
        # drop target column for scoring
        req_data = {str(k): (None if pd.isna(v) else v) for k, v in row.drop(labels=[target_col]).to_dict().items()}
        
        # some simulated metadata to make it look like a real transaction
        sender_id = f"ACC-{random.randint(1000, 9999)}"
        receiver_id = f"ACC-{random.randint(1000, 9999)}"
        amount = round(random.uniform(50.0, 15000.0), 2)
        
        try:
            scorecard = risk_engine.score_single_case(req_data)
        except Exception as e:
            print(f"Skipping row {i} due to scoring error: {e}")
            continue
            
        final_score = scorecard["scores"]["final_risk_score"]
        
        # Only create alerts for transactions that cross a certain threshold or just create them anyway for the dashboard?
        # If we want a mix of alerts, maybe we create an alert for all of them or just the ones with score >= 50, but let's make them all visible
        
        alert_id = f"ALT-{str(uuid.uuid4()).upper()}"
        
        reason_summary = scorecard["categorizations"]["risk_tier"] + " Risk Score Card triggered."
        if scorecard["rules_audit"]["triggered_rules_count"] > 0:
            reasons = [r["reason"] for r in scorecard["rules_audit"]["overrides"]]
            reason_summary += " Rule Violations detected: " + "; ".join(reasons)
        else:
            drivers = [d["feature"] for d in scorecard["explainability"]["key_risk_drivers"]]
            reason_summary += " Driven by high ML features variance: " + ", ".join(drivers)

        ts = now - timedelta(hours=random.randint(0, 168), minutes=random.randint(0, 60))
        logs_trail = [{"operator": "System Agent", "action": "Automatic Risk Score Evaluation", "timestamp": ts.strftime("%Y-%m-%dT%H:%M:%SZ")}]

        # Set realistic statuses based on score
        if final_score > 85:
            status = "Escalated"
        elif final_score > 65:
            status = random.choice(["Open", "Investigating"])
        else:
            status = random.choice(["Closed", "Open"])

        new_record = AlertModel(
            id=alert_id,
            transaction_id=scorecard["transaction_id"],
            sender_id=sender_id,
            receiver_id=receiver_id,
            amount=amount,
            risk_score=final_score,
            risk_tier=scorecard["categorizations"]["risk_tier"],
            severity=scorecard["categorizations"]["alert_severity"],
            status=status,
            reason=reason_summary,
            timestamp=ts.strftime("%Y-%m-%dT%H:%M:%SZ"),
            assigned_to="System Operator" if status != "Open" else "Unassigned",
            logs=json.dumps(logs_trail),
            features=json.dumps({"account_age_days": random.randint(0, 365), "is_international": random.choice([True, False])}),
            explainability=json.dumps(scorecard["explainability"]),
            _ts=ts.timestamp(),
            triage_action="Escalate" if final_score > 75 else "Review",
            priority_tier="High" if final_score > 75 else "Low",
            pu_probability=final_score / 100.0,
            tenant_id="default",
            org_id="FAGE-CORE",
        )
        alerts.append(new_record)
        
    db.add_all(alerts)
    db.commit()
    print(f"Successfully processed {len(alerts)} authentic transactions into the database.")
    db.close()

if __name__ == "__main__":
    seed_real_data()
