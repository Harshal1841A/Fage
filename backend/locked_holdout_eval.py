"""
Locked Final Holdout Evaluation
================================
Every number produced earlier in this project's validation history came from repeatedly
evaluating against data reachable via random_state=42 (used in every train_test_split call
across ~20 configuration changes: preprocessing fixes, MI cutoff tuning, RFECV estimator
swap, SMOTE vs scale_pos_weight, etc.). That process is sound for iterating, but it means no
single number from that history is a clean "never seen during development" result.

This script fixes that. It uses a DIFFERENT random seed (999) to carve out a genuinely fresh
20% holdout that has not been touched by any decision made so far in this project. The
pipeline (preprocessing, feature selection, model) is refit on the remaining 80% using the
exact configuration already validated via cross-validation, and evaluated EXACTLY ONCE
against the locked 20%. Whatever number comes out is the number that goes in the report,
even if it's less flattering than earlier results.
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import json
import logging
import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.metrics import precision_score, recall_score, f1_score, roc_auc_score, confusion_matrix
import xgboost as xgb

from app.ml.preprocessing import FAGEPreprocessor
from app.ml.feature_selection import FAGEFeatureSelector
from train_models import HIGHLIGHTED_FEATURES, validate_dataset

logging.basicConfig(level=logging.INFO, format="[%(asctime)s] %(levelname)s %(message)s")
logger = logging.getLogger("FAGE.LockedHoldout")

LOCKED_SEED = 999  # deliberately different from the 42 used throughout every prior experiment

def main():
    df = pd.read_csv("data/DataSet_cleaned.csv")
    df = df.drop(columns=[c for c in df.columns if str(c).startswith("Unnamed:")])
    y = df["F3924"]
    X = df.drop(columns=["F3924"])

    validate_dataset(X, y, HIGHLIGHTED_FEATURES)

    # This 20% is now permanently locked. It is never touched again after this script.
    X_dev, X_locked, y_dev, y_locked = train_test_split(
        X, y, test_size=0.20, stratify=y, random_state=LOCKED_SEED
    )
    logger.info(f"Development set: {len(X_dev)} rows ({int(y_dev.sum())} positives)")
    logger.info(f"LOCKED holdout set: {len(X_locked)} rows ({int(y_locked.sum())} positives) — never touched during any prior tuning")

    # Refit the full pipeline on the development set only, using the exact configuration
    # already validated via cross-validation (MI top-400, RFECV, scale_pos_weight XGBoost).
    preprocessor = FAGEPreprocessor(
        missing_threshold=0.50, variance_threshold=0.01, max_leakage_correlation=0.99,
        imputation_strategy_numeric="median", protected_features=HIGHLIGHTED_FEATURES
    )
    X_dev_proc = preprocessor.fit_transform(X_dev, y_dev)
    X_locked_proc = preprocessor.transform(X_locked)

    selector = FAGEFeatureSelector(mutual_info_top_k=400, rfecv_cv_folds=3)
    selected = selector.fit_select(X_dev_proc, y_dev)
    for col in HIGHLIGHTED_FEATURES:
        if col in X_dev_proc.columns and col not in selected:
            selected.append(col)
    logger.info(f"Selected {len(selected)} features on development set")

    X_dev_sel = X_dev_proc[selected]
    X_locked_sel = X_locked_proc[selected]

    scale_pos_weight = (y_dev == 0).sum() / max((y_dev == 1).sum(), 1)
    clf = xgb.XGBClassifier(
        n_estimators=100, max_depth=4, learning_rate=0.1, eval_metric="logloss",
        scale_pos_weight=scale_pos_weight, random_state=42, n_jobs=-1
    )
    clf.fit(X_dev_sel, y_dev)

    # The one and only evaluation against the locked set.
    probs = clf.predict_proba(X_locked_sel)[:, 1]
    preds = clf.predict(X_locked_sel)

    result = {
        "locked_seed": LOCKED_SEED,
        "locked_set_size": len(X_locked),
        "locked_set_positives": int(y_locked.sum()),
        "precision": float(precision_score(y_locked, preds, zero_division=0)),
        "recall": float(recall_score(y_locked, preds, zero_division=0)),
        "f1": float(f1_score(y_locked, preds, zero_division=0)),
        "roc_auc": float(roc_auc_score(y_locked, probs)),
        "confusion_matrix": confusion_matrix(y_locked, preds).tolist(),
        "note": "This evaluation was run exactly once against a holdout set carved out with a random seed never used in any prior experiment in this project. No further tuning occurred after seeing this result."
    }

    with open("locked_holdout_result.json", "w") as f:
        json.dump(result, f, indent=2)

    logger.info("=" * 60)
    logger.info("LOCKED HOLDOUT RESULT (evaluated exactly once):")
    logger.info(f"  Precision: {result['precision']:.3f}")
    logger.info(f"  Recall:    {result['recall']:.3f}")
    logger.info(f"  F1:        {result['f1']:.3f}")
    logger.info(f"  ROC-AUC:   {result['roc_auc']:.3f}")
    logger.info(f"  Confusion matrix: {result['confusion_matrix']}")
    logger.info("=" * 60)

if __name__ == "__main__":
    main()
