import sys
import os
import json
import logging
from typing import Dict, List, Tuple, Any, Optional
import numpy as np
import pandas as pd
from sklearn.base import clone
from sklearn.model_selection import StratifiedKFold
from sklearn.metrics import precision_recall_fscore_support, roc_auc_score
from scipy.stats import ks_2samp

logger = logging.getLogger("FAGE.ML.PUEngine")
if not logger.handlers:
    handler = logging.StreamHandler(sys.stdout)
    formatter = logging.Formatter("[%(asctime)s] %(levelname)s [%(name)s:%(lineno)s] %(message)s")
    handler.setFormatter(formatter)
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)


class FAGEPUEngine:
    """
    Positive-Unlabeled (PU) Learning Correction Engine for FAGE.
    
    Addresses the core label imperfection in financial crime detection:
    In our dataset (81 confirmed positives, 9,001 unconfirmed accounts), the "negative" class
    actually consists of unlabeled examples (U), some of which are undiscovered mule accounts.
    
    Implements:
    1. Elkan-Noto Probability Calibration:
       Estimates label frequency c = P(s=1|y=1) using positive validation examples,
       and rescales raw model probabilities: P(y=1|x) = min(1.0, P(s=1|x) / c).
    2. Two-Step Reliable Negative Spy Technique:
       Injects a random sample of confirmed positives as 'spies' into the unlabeled set,
       trains a classifier to learn the probability distribution of hidden positives, and
       identifies a strict cutoff below which unlabeled accounts can be certified as
       reliable true negatives (RN).
    """

    def __init__(
        self,
        n_splits: int = 5,
        spy_rate: float = 0.15,
        spy_tolerance_percentile: float = 5.0,
        random_state: int = 42
    ):
        """
        Args:
            n_splits: Number of cross-validation folds for PU evaluation.
            spy_rate: Fraction of positive examples to convert to spies in the U set.
            spy_tolerance_percentile: Percentile of spy scores to set as reliable negative cutoff threshold.
            random_state: Random seed for reproducibility.
        """
        self.n_splits = n_splits
        self.spy_rate = spy_rate
        self.spy_tolerance_percentile = spy_tolerance_percentile
        self.random_state = random_state
        
        self.c_estimate_: Optional[float] = None
        self.spy_threshold_: Optional[float] = None
        self.reliable_negatives_mask_: Optional[np.ndarray] = None

    def estimate_label_frequency(
        self,
        y_prob: np.ndarray,
        s: np.ndarray,
        method: str = "elkan_noto"
    ) -> float:
        """
        Estimates the constant c = P(s=1 | y=1), representing the probability that a true positive
        mule account is discovered and labeled s=1 in our training set.
        
        Under Elkan & Noto (2008), for positive examples (where s=1 => y=1), we have:
        P(s=1|x) = P(s=1|y=1,x) * P(y=1|x) = c * P(y=1|x).
        Since P(y=1|x=pos_example) ≈ 1 for clear true positives, c ≈ mean(P(s=1|x)) over x in S_1.
        
        Args:
            y_prob: Predicted probabilities P(s=1|x) from a model trained on (X, s).
            s: Binary label vector (1 for confirmed mule, 0 for unlabeled).
            method: Estimation method ('elkan_noto' or 'median').
            
        Returns:
            Estimated c factor clamped to [0.05, 1.0].
        """
        pos_mask = (s == 1)
        if not np.any(pos_mask):
            logger.warning("No positive examples found for label frequency estimation. Defaulting c=1.0.")
            return 1.0
            
        pos_probs = y_prob[pos_mask]
        
        if method == "median":
            c = float(np.median(pos_probs))
        else:  # elkan_noto
            c = float(np.mean(pos_probs))
            
        # Clamp c to ensure stability against division errors
        c = max(0.05, min(1.0, c))
        logger.info(f"Estimated PU label frequency factor c = {c:.4f} (using {method} on {len(pos_probs)} positive examples).")
        return c

    def calibrate_probabilities(self, y_prob: np.ndarray, c: Optional[float] = None) -> np.ndarray:
        """
        Calibrates raw probabilities P(s=1|x) to true class probabilities P(y=1|x).
        
        Args:
            y_prob: Raw predicted probabilities P(s=1|x).
            c: Label frequency c. If None, uses fitted self.c_estimate_.
            
        Returns:
            Calibrated probabilities P(y=1|x) bounded in [0.0, 1.0].
        """
        c_val = c if c is not None else (self.c_estimate_ if self.c_estimate_ is not None else 1.0)
        c_val = max(0.05, c_val)
        calibrated = np.clip(y_prob / c_val, 0.0, 1.0)
        return calibrated

    @property
    def c_(self) -> float:
        return self.c_estimate_ if self.c_estimate_ is not None else 1.0

    def online_recalibrate(
        self,
        label: str,
        score: float = 0.5,
        learning_rate: float = 0.05
    ) -> Tuple[float, float, Optional[float], Optional[float]]:
        """
        Closed-loop online recalibration when an analyst submits ground truth feedback.
        Adjusts the Elkan-Noto PU calibration factor c and SPY reliable negative threshold.
        
        Args:
            label: Ground truth label ('True Positive', 'False Positive', 'Mule Ring', etc.)
            score: Raw model probability P(s=1|x) for the labeled alert.
            learning_rate: Exponential moving average learning rate.
            
        Returns:
            Tuple of (old_c, new_c, old_spy, new_spy)
        """
        old_c = self.c_estimate_ if self.c_estimate_ is not None else 0.725
        old_spy = self.spy_threshold_ if self.spy_threshold_ is not None else 0.152

        new_c = old_c
        new_spy = old_spy

        clean_label = label.strip().lower()
        if clean_label in ["true positive", "mule ring", "confirmed fraud", "suspicious"]:
            # Discovering hidden positive updates the empirical discovery probability estimate c = P(s=1|y=1)
            # If the discovered positive had raw probability `score`, incorporate into c moving average
            new_c = old_c * (1.0 - learning_rate) + max(0.05, min(1.0, score)) * learning_rate
            new_c = max(0.05, min(1.0, new_c))
            # If the true positive had a score lower than or near spy_threshold, relax spy_threshold slightly
            if new_spy is not None and score < new_spy + 0.05:
                new_spy = max(0.01, new_spy * 0.96)
        elif clean_label in ["false positive", "legitimate", "clear", "false_positive"]:
            # False alarm at high probability implies reliable negative threshold tau should tighten upward
            if new_spy is not None and score > new_spy:
                new_spy = min(0.95, new_spy * (1.0 + learning_rate * 0.5))
            # Slightly tighten c factor
            new_c = max(0.05, min(1.0, old_c * 0.995))

        self.c_estimate_ = float(new_c)
        if self.spy_threshold_ is not None:
            self.spy_threshold_ = float(new_spy)

        logger.info(f"PU online recalibration triggered ({label}): c factor {old_c:.4f} -> {new_c:.4f}, SPY threshold {old_spy} -> {new_spy}")
        return float(old_c), float(new_c), old_spy, new_spy

    def fit(self, X: pd.DataFrame, s: pd.Series, base_model: Any = None) -> "FAGEPUEngine":
        """
        Fits the PU engine by running spy technique and frequency estimation.
        """
        if base_model is None:
            from xgboost import XGBClassifier
            base_model = XGBClassifier(n_estimators=50, max_depth=4, random_state=self.random_state)
        self.run_spy_technique(X, s, base_model)
        if self.c_estimate_ is None:
            if hasattr(base_model, "predict_proba"):
                probs = base_model.predict_proba(X)[:, 1]
            else:
                probs = base_model.predict(X)
            self.c_estimate_ = self.estimate_label_frequency(probs, np.array(s))
        return self


    def run_spy_technique(
        self,
        X: pd.DataFrame,
        s: pd.Series,
        base_model: Any
    ) -> Tuple[np.ndarray, float, Dict[str, Any]]:
        """
        Executes the Two-Step Reliable Negative Spy technique.
        
        Step 1: Randomly sample `spy_rate` of confirmed positives (S_1) to act as spies (S_spy).
        Step 2: Assign label 0 to S_spy along with all existing unlabeled examples (U).
        Step 3: Train base_model on this modified dataset and predict probabilities on all examples.
        Step 4: Determine spy cutoff threshold tau based on `spy_tolerance_percentile` of spy scores.
        Step 5: All unlabeled examples scoring below tau are designated Reliable Negatives (RN).
        
        Args:
            X: Feature matrix.
            s: Binary label vector (1 for confirmed pos, 0 for unlabeled).
            base_model: Unfitted estimator (e.g. XGBClassifier).
            
        Returns:
            Tuple of (reliable_negatives_mask, spy_threshold, stats_dict).
        """
        logger.info(f"Running PU Spy Technique with spy_rate={self.spy_rate} and tolerance={self.spy_tolerance_percentile}th percentile.")
        s_array = np.array(s)
        pos_indices = np.where(s_array == 1)[0]
        unlabeled_indices = np.where(s_array == 0)[0]
        
        if len(pos_indices) < 10:
            logger.warning("Too few positive indices for spy technique. Skipping reliable negative identification.")
            rn_mask = (s_array == 0)
            return rn_mask, 0.0, {"num_spies": 0, "num_reliable_negatives": int(np.sum(rn_mask))}
            
        np.random.seed(self.random_state)
        n_spies = max(2, int(len(pos_indices) * self.spy_rate))
        spy_indices = np.random.choice(pos_indices, size=n_spies, replace=False)
        
        # Create modified spy labels vector
        s_spy = s_array.copy()
        s_spy[spy_indices] = 0
        
        # Train spy classifier
        spy_model = clone(base_model)
        spy_model.fit(X, s_spy)
        
        # Predict probabilities
        if hasattr(spy_model, "predict_proba"):
            probs = spy_model.predict_proba(X)[:, 1]
        else:
            probs = spy_model.predict(X)
            
        # Analyze spy scores to find safety threshold
        spy_probs = probs[spy_indices]
        spy_threshold = float(np.percentile(spy_probs, self.spy_tolerance_percentile))
        
        # Identify reliable negatives among originally unlabeled examples
        rn_mask = (s_array == 0) & (probs < spy_threshold)
        self.spy_threshold_ = spy_threshold
        self.reliable_negatives_mask_ = rn_mask
        
        stats = {
            "num_positives_total": len(pos_indices),
            "num_spies_sampled": n_spies,
            "spy_threshold": spy_threshold,
            "mean_spy_probability": float(np.mean(spy_probs)),
            "min_spy_probability": float(np.min(spy_probs)),
            "num_unlabeled_total": len(unlabeled_indices),
            "num_reliable_negatives": int(np.sum(rn_mask)),
            "reliable_negative_pct": float(np.sum(rn_mask) / max(1, len(unlabeled_indices)) * 100.0)
        }
        logger.info(f"PU Spy stats: threshold={spy_threshold:.4f}, identified {stats['num_reliable_negatives']} reliable negatives ({stats['reliable_negative_pct']:.1f}% of U).")
        return rn_mask, spy_threshold, stats




def calculate_psi(baseline_arr: np.ndarray, current_arr: np.ndarray, num_bins: int = 10) -> float:
    """
    Calculates Population Stability Index (PSI) between baseline holdout distribution and current live distribution.
    PSI = sum((Actual_i - Expected_i) * ln(Actual_i / Expected_i))
    """
    baseline_clean = np.array(baseline_arr)
    current_clean = np.array(current_arr)
    baseline_clean = baseline_clean[~np.isnan(baseline_clean)]
    current_clean = current_clean[~np.isnan(current_clean)]

    if len(baseline_clean) == 0 or len(current_clean) == 0:
        return 0.0

    # Create quantiles from baseline
    quantiles = np.linspace(0, 100, num_bins + 1)
    bins = np.percentile(baseline_clean, quantiles)
    bins[0] = -np.inf
    bins[-1] = np.inf
    bins = np.unique(bins)
    if len(bins) < 2:
        return 0.0

    expected_counts, _ = np.histogram(baseline_clean, bins=bins)
    actual_counts, _ = np.histogram(current_clean, bins=bins)

    expected_pct = (expected_counts + 1e-4) / (len(baseline_clean) + 1e-4 * len(expected_counts))
    actual_pct = (actual_counts + 1e-4) / (len(current_clean) + 1e-4 * len(actual_counts))

    psi = np.sum((actual_pct - expected_pct) * np.log(actual_pct / expected_pct))
    return float(psi)


def detect_feature_drift(
    baseline_df: pd.DataFrame,
    current_df: pd.DataFrame,
    features: Optional[List[str]] = None
) -> Dict[str, Any]:
    """
    Evaluates drift across key numeric features using Population Stability Index (PSI) and Kolmogorov-Smirnov test.
    """
    if features is None:
        features = [col for col in ["amount", "velocity_6h", "structuring_ratio", "risk_score"] if col in baseline_df.columns and col in current_df.columns]

    drift_results = {}
    max_psi = 0.0

    for feat in features:
        b_vals = baseline_df[feat].dropna().values
        c_vals = current_df[feat].dropna().values
        psi = calculate_psi(b_vals, c_vals)
        max_psi = max(max_psi, psi)

        try:
            ks_res = ks_2samp(b_vals, c_vals)
            ks_stat = float(ks_res.statistic)
            ks_pvalue = float(ks_res.pvalue)
        except Exception:
            ks_stat = 0.0
            ks_pvalue = 1.0

        if psi > 0.25:
            status = "Critical Drift"
        elif psi > 0.10:
            status = "Moderate Drift"
        else:
            status = "Stable"

        drift_results[feat] = {
            "psi": round(float(psi), 4),
            "status": status,
            "ks_stat": round(ks_stat, 4),
            "ks_pvalue": round(ks_pvalue, 4)
        }

    overall_status = "Critical Drift Detected" if max_psi > 0.25 else ("Moderate Drift Detected" if max_psi > 0.10 else "Stable Distribution")
    return {
        "overall_status": overall_status,
        "max_psi": round(float(max_psi), 4),
        "features": drift_results
    }


class FAGEAdaptiveEngine:
    """
    Online Learning & Drift Adaptation Wrapper for FAGEPUEngine.
    Detects feature drift when attackers shift structuring schemes (e.g. micro-structuring below $9k reporting limit,
    or velocity slowdowns in mule rings) and applies online probability/threshold adaptation.
    """

    def __init__(self, pu_engine: FAGEPUEngine):
        self.pu_engine = pu_engine
        self.adaptation_history: List[Dict[str, Any]] = []
        self.current_shift_status: Dict[str, Any] = {
            "status": "Stable",
            "overall_psi": 0.042,
            "drift_alert_level": "NORMAL",
            "active_adaptation_weights": {"amount_weight": 1.0, "velocity_weight": 1.0},
            "last_recalibrated": "2026-07-16T08:00:00Z"
        }

