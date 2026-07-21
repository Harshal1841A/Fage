"""
FAGE Cross-Validation Diagnostic
================================
The single 60/40 holdout split used by train_models.py produces a validation set
with only ~32 positive (fraud) examples, out of 9,082 total rows at a 0.89% base
rate. At that sample size, a handful of flipped predictions swings precision or
recall by double-digit percentage points — a single-split number is not a
defensible thing to put in front of judges asking "how stable is that metric."

This script runs proper stratified k-fold cross-validation instead: for each fold,
the preprocessor and feature selector are re-fit on that fold's training data only
(to avoid any leakage from feature-selection decisions made on validation data),
each model is trained with the same fixed hyperparameters used in production, and
metrics are collected out-of-fold. The result is a mean +/- std per metric per
model — report the mean and the spread together, not just the mean.

This does NOT replace train_models.py's single-split run, which still produces the
deployed model artifacts (models/*.pkl). This script is a reporting/validation
layer on top, run separately, producing cv_metrics.json.
"""
import os
import sys
import json
import logging
import time
from typing import Dict, List, Any

import numpy as np
import pandas as pd
from sklearn.model_selection import StratifiedKFold
from sklearn.metrics import (
    accuracy_score, precision_score, recall_score, f1_score,
    roc_auc_score, average_precision_score
)

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from app.ml.preprocessing import FAGEPreprocessor
from app.ml.feature_selection import FAGEFeatureSelector

from train_models import (
    load_or_generate_dataset, validate_dataset, HIGHLIGHTED_FEATURES,
    train_eval_xgb, train_eval_lgbm, train_eval_random_forest,
    train_eval_extra_trees, train_eval_logistic_regression,
)

logging.basicConfig(level=logging.INFO, format="[%(asctime)s] %(levelname)s [%(name)s] %(message)s")
logger = logging.getLogger("FAGE.ML.CrossValidation")

N_SPLITS = 5

MODEL_FUNCS = {
    "XGBoost": train_eval_xgb,
}


def run_fold(fold_idx: int, X_train_raw: pd.DataFrame, y_train: pd.Series,
             X_val_raw: pd.DataFrame, y_val: pd.Series) -> Dict[str, Dict[str, float]]:
    logger.info(f"--- Fold {fold_idx + 1}/{N_SPLITS}: fitting preprocessor + selector on this fold's train split only ---")

    preprocessor = FAGEPreprocessor(
        missing_threshold=0.50,
        variance_threshold=0.01,
        max_leakage_correlation=0.99,
        imputation_strategy_numeric="median",
        protected_features=HIGHLIGHTED_FEATURES,
    )
    X_train_proc = preprocessor.fit_transform(X_train_raw, y_train)
    X_val_proc = preprocessor.transform(X_val_raw)

    # NOTE: this diagnostic script uses top-K mutual-information selection only, skipping
    # the RFECV refinement step that train_models.py uses for the deployed model. RFECV was
    # observed to hang indefinitely on some fold subsets in this environment (reproduced with
    # both n_jobs=-1 and n_jobs=1, 5+ minutes of real CPU time with no completion) — a
    # sklearn/environment interaction, not something worth blocking a report deadline on.
    # Straight MI selection is a legitimate, disclosed simplification for a CV *diagnostic*;
    # it is not used for the actual deployed models in models/*.pkl.
    selector = FAGEFeatureSelector(mutual_info_top_k=400, rfecv_cv_folds=3)
    mi_scores = selector.compute_mutual_information(X_train_proc, y_train)
    numeric_cols = X_train_proc.select_dtypes(include=[np.number]).columns.tolist()
    top_mi = [c for c in mi_scores.keys() if c in numeric_cols][:400]
    categorical_cols = X_train_proc.select_dtypes(exclude=[np.number]).columns.tolist()
    selected = top_mi + categorical_cols

    for col in HIGHLIGHTED_FEATURES:
        if col in X_train_proc.columns and col not in selected:
            selected.append(col)

    X_train_sel = X_train_proc[selected]
    X_val_sel = X_val_proc[selected]

    fold_results = {}
    dummy_cv = None  # the per-model functions accept a cv arg but don't use it for anything but a signature match
    for name, fn in MODEL_FUNCS.items():
        _, _, metrics = fn(X_train_sel, y_train, X_val_sel, y_val, dummy_cv)
        metrics.pop("confusion_matrix", None)
        fold_results[name] = metrics

    return fold_results


def main():
    logger.info("=====================================================")
    logger.info("   FAGE STRATIFIED K-FOLD CROSS-VALIDATION (k=%d)   " % N_SPLITS)
    logger.info("=====================================================")

    X_raw, y = load_or_generate_dataset()
    validate_dataset(X_raw, y, HIGHLIGHTED_FEATURES)
    logger.info(f"Total positive (fraud) examples in full dataset: {int((y == 1).sum())} out of {len(y)} rows")

    skf = StratifiedKFold(n_splits=N_SPLITS, shuffle=True, random_state=42)

    all_fold_metrics: Dict[str, List[Dict[str, float]]] = {name: [] for name in MODEL_FUNCS}

    start = time.time()
    for fold_idx, (train_idx, val_idx) in enumerate(skf.split(X_raw, y)):
        X_train_raw = X_raw.iloc[train_idx].reset_index(drop=True)
        y_train = y.iloc[train_idx].reset_index(drop=True)
        X_val_raw = X_raw.iloc[val_idx].reset_index(drop=True)
        y_val = y.iloc[val_idx].reset_index(drop=True)

        n_pos_val = int((y_val == 1).sum())
        logger.info(f"Fold {fold_idx + 1}: train={len(X_train_raw)} rows / val={len(X_val_raw)} rows ({n_pos_val} positives in val fold)")

        fold_results = run_fold(fold_idx, X_train_raw, y_train, X_val_raw, y_val)
        for name, metrics in fold_results.items():
            all_fold_metrics[name].append(metrics)

    elapsed = time.time() - start
    logger.info(f"Cross-validation complete in {elapsed:.1f}s")

    summary = {}
    metric_keys = ["accuracy", "precision", "recall", "f1", "roc_auc", "pr_auc"]
    for name, fold_list in all_fold_metrics.items():
        summary[name] = {}
        for mk in metric_keys:
            vals = [f[mk] for f in fold_list]
            summary[name][mk] = {
                "mean": float(np.mean(vals)),
                "std": float(np.std(vals)),
                "per_fold": [float(v) for v in vals],
            }

    with open("cv_metrics.json", "w") as f:
        json.dump(summary, f, indent=4)

    logger.info("\n" + "=" * 70)
    logger.info(f"{'Model':<20}{'Precision':<18}{'Recall':<18}{'ROC-AUC':<15}")
    logger.info("=" * 70)
    for name, m in summary.items():
        p = f"{m['precision']['mean']:.3f} +/- {m['precision']['std']:.3f}"
        r = f"{m['recall']['mean']:.3f} +/- {m['recall']['std']:.3f}"
        a = f"{m['roc_auc']['mean']:.3f} +/- {m['roc_auc']['std']:.3f}"
        logger.info(f"{name:<20}{p:<18}{r:<18}{a:<15}")
    logger.info("=" * 70)
    logger.info("Saved to cv_metrics.json — cite mean +/- std in the report, not a single-split point estimate.")


if __name__ == "__main__":
    main()
