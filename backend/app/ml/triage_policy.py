import sys
import logging
from typing import Dict, List, Any, Optional

logger = logging.getLogger("FAGE.ML.TriagePolicy")
if not logger.handlers:
    handler = logging.StreamHandler(sys.stdout)
    formatter = logging.Formatter("[%(asctime)s] %(levelname)s [%(name)s:%(lineno)s] %(message)s")
    handler.setFormatter(formatter)
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)


class FAGETriagePolicy:
    """
    Confidence-Routed Operational Triage Engine for FAGE.
    
    Replaces static/flat threshold rules with a multi-dimensional decision policy combining:
    1. Risk Score (or Calibrated PU Probability * 100)
    2. Bootstrap Confidence Interval Width (Uncertainty / Boundary proximity)
    3. Adversarial Evasion Fragility (Whether small feature perturbations flip the model decision)
    
    Triage Action Categories:
    - FAST_TRACK_FREEZE: High risk (>= 75), narrow CI width (< 0.15), robust against evasion.
    - PRIORITY_MANUAL_REVIEW: High/Medium risk (>= 50) with wide CI (width >= 0.15) indicating boundary uncertainty.
    - INDEPENDENT_SIGNAL_CHECK: High risk (>= 75) but fragile against adversarial evasion shifts.
    - STANDARD_MONITORING: Low risk (< 50) and stable.
    """

    def __init__(
        self,
        high_risk_threshold: float = 75.0,
        medium_risk_threshold: float = 50.0,
        ci_uncertainty_threshold: float = 0.15
    ):
        """
        Args:
            high_risk_threshold: Score cutoff above which alert is considered high risk (0-100 scale).
            medium_risk_threshold: Score cutoff above which alert requires investigation.
            ci_uncertainty_threshold: Confidence interval width cutoff (upper - lower probability scale 0-1) above which model prediction has high uncertainty.
        """
        self.high_risk_threshold = high_risk_threshold
        self.medium_risk_threshold = medium_risk_threshold
        self.ci_uncertainty_threshold = ci_uncertainty_threshold

    def evaluate_account(
        self,
        risk_score: float,
        ci_lower: float,
        ci_upper: float,
        evadable: bool,
        pu_probability: Optional[float] = None,
        account_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Evaluates a single account's risk profile to determine operational triage routing and priority.
        
        Args:
            risk_score: Model risk score on 0-100 scale.
            ci_lower: Lower bound probability of bootstrap CI (0-1 scale).
            ci_upper: Upper bound probability of bootstrap CI (0-1 scale).
            evadable: Boolean indicating if adversarial perturbation can evade classification.
            pu_probability: Calibrated PU probability on 0-1 scale.
            account_id: Optional account identifier string.
            
        Returns:
            Dictionary containing triage_action, priority_tier, confidence_width, and rationale.
        """
        # Calculate uncertainty width
        ci_width = float(abs(ci_upper - ci_lower))
        effective_score = risk_score
        
        # Determine Triage Action and Priority Tier
        if effective_score >= self.high_risk_threshold:
            if evadable:
                action = "INDEPENDENT_SIGNAL_CHECK"
                priority = "High"
                rationale = "High risk score but fragile against adversarial feature shifts. Require out-of-band verification before asset freeze."
            elif ci_width >= self.ci_uncertainty_threshold:
                action = "PRIORITY_MANUAL_REVIEW"
                priority = "High"
                rationale = f"High risk score with wide model boundary uncertainty (CI width {ci_width:.2f} >= {self.ci_uncertainty_threshold}). Analyst review mandated."
            else:
                action = "FAST_TRACK_FREEZE"
                priority = "Critical"
                rationale = "High risk score with narrow confidence bounds and robust evasion resistance. Immediate automated freeze recommended."
        elif effective_score >= self.medium_risk_threshold:
            if ci_width >= self.ci_uncertainty_threshold:
                action = "PRIORITY_MANUAL_REVIEW"
                priority = "High"
                rationale = f"Medium risk with wide decision boundary uncertainty (CI width {ci_width:.2f}). Priority manual review required."
            elif evadable:
                action = "INDEPENDENT_SIGNAL_CHECK"
                priority = "Medium"
                rationale = "Medium risk and evadable profile. Perform independent KYC or device fingerprint check."
            else:
                action = "PRIORITY_MANUAL_REVIEW"
                priority = "Medium"
                rationale = "Medium risk score requiring compliance investigation."
        else:
            # Low risk (< 50)
            if ci_width >= self.ci_uncertainty_threshold and effective_score >= 35.0:
                action = "PRIORITY_MANUAL_REVIEW"
                priority = "Medium"
                rationale = f"Score below 50 ({effective_score:.1f}) but high model uncertainty (CI width {ci_width:.2f}). Review for borderline mule characteristics."
            else:
                action = "STANDARD_MONITORING"
                priority = "Low"
                rationale = "Low risk profile within stable confidence bounds. Continue standard transaction monitoring."

        return {
            "account_id": account_id or "N/A",
            "risk_score": float(effective_score),
            "pu_probability": float(pu_probability) if pu_probability is not None else float(effective_score / 100.0),
            "ci_lower": float(ci_lower),
            "ci_upper": float(ci_upper),
            "ci_width": float(ci_width),
            "evadable": bool(evadable),
            "triage_action": action,
            "priority_tier": priority,
            "rationale": rationale
        }

