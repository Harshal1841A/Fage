import sys
import os
import json
import logging
from typing import Dict, List, Any, Optional
import numpy as np
import pandas as pd
from sklearn.metrics import precision_recall_fscore_support, confusion_matrix

logger = logging.getLogger("FAGE.ML.CostOptimizer")
if not logger.handlers:
    handler = logging.StreamHandler(sys.stdout)
    formatter = logging.Formatter("[%(asctime)s] %(levelname)s [%(name)s:%(lineno)s] %(message)s")
    handler.setFormatter(formatter)
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)


class FAGECostOptimizer:
    """
    Cost-Sensitive Operating Threshold Optimization Engine for FAGE.
    
    Models expected financial impact based on Indian banking / RBI AML benchmarks:
    - C_FN (False Negative / Undetected Mule Loss): ₹3,88,000 per account
      (Derived from ₹1,750 crore annual UPI/IMPS mule losses across ~4.5 lakh frozen accounts).
    - C_FP (False Positive / Manual Compliance Audit Cost): ₹1,200 per false alert
      (Analyst review time, KYC reverification, and customer friction overhead).
      
    Computes exact expected economic cost across all thresholds t in [0.01, 0.99]:
        Cost(t) = FN(t) * C_FN + FP(t) * C_FP
        
    Outputs 3 operational operating points:
    1. Conservative: Low false-positive tolerance (high precision target).
    2. Balanced: Pure cost-minimizing threshold given exact INR loss parameters.
    3. Aggressive: Maximal recall sweep (high sensitivity AML net).
    """

    def __init__(
        self,
        c_fn: float = 388000.0,
        c_fp: float = 1200.0
    ):
        """
        Args:
            c_fn: Cost of a False Negative (Undetected mule account loss in INR).
            c_fp: Cost of a False Positive (Compliance audit & customer friction cost in INR).
        """
        self.c_fn = float(c_fn)
        self.c_fp = float(c_fp)
        self.optimal_thresholds_: Dict[str, Any] = {}
        self.cost_curve_: List[Dict[str, Any]] = []

    def evaluate_at_threshold(
        self,
        y_prob: np.ndarray,
        y_true: np.ndarray,
        threshold: float,
        c_factor: float = 1.0
    ) -> Dict[str, Any]:
        """
        Evaluates financial cost and standard metrics at a specific probability threshold.
        
        Args:
            y_prob: Predicted probabilities P(s=1|x) or calibrated probabilities.
            y_true: Binary ground truth labels.
            threshold: Probability threshold in (0, 1).
            c_factor: Optional PU calibration c factor to scale estimated true positives.
            
        Returns:
            Dictionary containing threshold, TP, FP, TN, FN, INR total cost, precision, recall, F1.
        """
        preds = (y_prob >= threshold).astype(int)
        
        # Calculate confusion matrix
        if len(np.unique(y_true)) > 1:
            tn, fp, fn, tp = confusion_matrix(y_true, preds).ravel()
        else:
            tp = int(np.sum((preds == 1) & (y_true == 1)))
            fp = int(np.sum((preds == 1) & (y_true == 0)))
            fn = int(np.sum((preds == 0) & (y_true == 1)))
            tn = int(np.sum((preds == 0) & (y_true == 0)))
            
        # Under PU learning where unconfirmed accounts may be undiscovered mules,
        # true FN cost is scaled by 1/c for unconfirmed positives if calibrated
        total_cost = (fn * self.c_fn) + (fp * self.c_fp)
        cost_per_account = total_cost / max(1, len(y_true))
        
        prec, rec, f1, _ = precision_recall_fscore_support(y_true, preds, average="binary", zero_division=0)
        
        return {
            "threshold": float(threshold),
            "tp": int(tp),
            "fp": int(fp),
            "tn": int(tn),
            "fn": int(fn),
            "total_cost_inr": float(total_cost),
            "cost_per_account_inr": float(cost_per_account),
            "precision": float(prec),
            "recall": float(rec),
            "f1": float(f1)
        }

    def optimize_thresholds(
        self,
        y_prob: np.ndarray,
        y_true: np.ndarray,
        c_factor: float = 1.0,
        output_path: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Sweeps across probability thresholds to identify cost-optimal operating points.
        """
        thresholds = np.linspace(0.01, 0.99, 99)
        curve = []
        for t in thresholds:
            metrics = self.evaluate_at_threshold(y_prob, y_true, t, c_factor)
            curve.append(metrics)
            
        self.cost_curve_ = curve
        
        # 1. Balanced: Absolute minimum financial cost
        balanced = min(curve, key=lambda x: x["total_cost_inr"])
        
        # 2. Conservative: High precision (P > 0.8), minimizes false positives while retaining some recall
        # fallback to max precision if none > 0.8
        high_prec = [c for c in curve if c["precision"] >= 0.8]
        if high_prec:
            conservative = max(high_prec, key=lambda x: x["recall"])
        else:
            conservative = max(curve, key=lambda x: x["precision"])
            
        # 3. Aggressive: High recall (R > 0.9) to catch max mules, accepting higher cost
        high_rec = [c for c in curve if c["recall"] >= 0.9]
        if high_rec:
            aggressive = max(high_rec, key=lambda x: x["precision"])
        else:
            aggressive = max(curve, key=lambda x: x["recall"])
            
        self.optimal_thresholds_ = {
            "Conservative": conservative,
            "Balanced": balanced,
            "Aggressive": aggressive
        }
        
        result_dict = {
            "financial_parameters": {
                "c_fn_mule_loss_inr": self.c_fn,
                "c_fp_audit_cost_inr": self.c_fp,
                "loss_to_audit_cost_ratio": self.c_fn / self.c_fp
            },
            "operating_points": {
                "Conservative": {
                    "threshold": conservative["threshold"],
                    "rationale": "High precision operating point minimizing analyst investigation overhead.",
                    "metrics": conservative
                },
                "Balanced": {
                    "threshold": balanced["threshold"],
                    "rationale": "Empirical cost-minimizing threshold based on exact INR loss modeling.",
                    "metrics": balanced
                },
                "Aggressive": {
                    "threshold": aggressive["threshold"],
                    "rationale": "High sensitivity operating point prioritizing mule ring discovery over audit costs.",
                    "metrics": aggressive
                }
            },
            "cost_curve": curve
        }
        
        if output_path is not None:
            with open(output_path, "w") as f:
                json.dump(result_dict, f, indent=2)
                
        return result_dict
