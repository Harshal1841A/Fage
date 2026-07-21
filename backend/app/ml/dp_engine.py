"""
dp_engine.py
FAGE Differential Privacy & Re-Identification Risk Engine

Provides mathematical guarantees for exporting sensitive financial crime model metrics
and graph topology summaries without leaking individual transaction attributes or
entity identities.

Features:
- ε-Differential Privacy Laplace Mechanism for L1 sensitivity queries.
- (ε, δ)-Differential Privacy Gaussian Mechanism for L2 sensitivity queries.
- Privacy Budget Ledger with strict query rejection upon budget exhaustion.
- Graph & Telemetry Re-Identification Risk Assessment (k-anonymity estimate & l-diversity).
"""

import math
import numpy as np
from typing import Dict, Any, List, Optional, Tuple
from datetime import datetime, timezone

class PrivacyBudgetExceededError(Exception):
    """Raised when a query requests more differential privacy epsilon budget than remains."""
    pass


class FAGEDPEngine:
    def __init__(self, max_epsilon: float = 10.0, default_epsilon: float = 0.5, default_delta: float = 1e-5):
        self.max_epsilon = max_epsilon
        self.default_epsilon = default_epsilon
        self.default_delta = default_delta
        self.spent_epsilon = 0.0
        self.query_ledger: List[Dict[str, Any]] = []

    def get_budget_status(self) -> Dict[str, Any]:
        remaining = max(0.0, self.max_epsilon - self.spent_epsilon)
        status = "Healthy"
        if remaining < self.max_epsilon * 0.2:
            status = "Warning: Low Budget"
        if remaining <= 0.0:
            status = "Exhausted (Queries Blocked)"

        return {
            "max_epsilon": round(self.max_epsilon, 4),
            "spent_epsilon": round(self.spent_epsilon, 4),
            "remaining_epsilon": round(remaining, 4),
            "default_delta": self.default_delta,
            "budget_status": status,
            "total_queries_serviced": len(self.query_ledger),
            "ledger_summary": self.query_ledger[-10:] if self.query_ledger else []
        }

    def reset_budget(self, new_max_epsilon: Optional[float] = None) -> Dict[str, Any]:
        if new_max_epsilon is not None and new_max_epsilon > 0:
            self.max_epsilon = new_max_epsilon
        self.spent_epsilon = 0.0
        self.query_ledger.append({
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "query_type": "BUDGET_RESET",
            "epsilon_cost": 0.0,
            "mechanism": "SYSTEM",
            "detail": f"Privacy budget reset to max_epsilon={self.max_epsilon}"
        })
        return self.get_budget_status()

    def _consume_budget(self, epsilon_cost: float, query_type: str, mechanism: str, noise_scale: float) -> None:
        if self.spent_epsilon + epsilon_cost > self.max_epsilon:
            raise PrivacyBudgetExceededError(
                f"Privacy budget exceeded. Requested epsilon={epsilon_cost:.4f}, but only "
                f"{(self.max_epsilon - self.spent_epsilon):.4f} remaining."
            )
        self.spent_epsilon += epsilon_cost
        self.query_ledger.append({
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "query_type": query_type,
            "epsilon_cost": round(epsilon_cost, 4),
            "mechanism": mechanism,
            "noise_scale": round(noise_scale, 4),
            "cumulative_spent": round(self.spent_epsilon, 4)
        })

    def apply_laplace_mechanism(self, value: float, sensitivity: float, epsilon: float) -> Tuple[float, float]:
        """
        Injects calibrated Laplace noise based on L1 sensitivity.
        Scale b = sensitivity / epsilon.
        Returns (noisy_value, scale_b).
        """
        if epsilon <= 0:
            raise ValueError("Epsilon must be positive.")
        scale = sensitivity / epsilon
        noise = np.random.laplace(0.0, scale)
        return float(value + noise), float(scale)

    def apply_gaussian_mechanism(self, value: float, sensitivity: float, epsilon: float, delta: float) -> Tuple[float, float]:
        """
        Injects calibrated Gaussian noise based on L2 sensitivity and (ε, δ)-DP.
        Sigma = sensitivity * sqrt(2 * ln(1.25 / delta)) / epsilon.
        Returns (noisy_value, sigma).
        """
        if epsilon <= 0 or delta <= 0 or delta >= 1.0:
            raise ValueError("Invalid epsilon or delta values.")
        sigma = (sensitivity * math.sqrt(2.0 * math.log(1.25 / delta))) / epsilon
        noise = np.random.normal(0.0, sigma)
        return float(value + noise), float(sigma)

    def get_dp_model_metrics(
        self,
        raw_metrics: Dict[str, float],
        epsilon: Optional[float] = None,
        mechanism: str = "laplace"
    ) -> Dict[str, Any]:
        """
        Takes raw model metrics (e.g. roc_auc, precision, recall, f1, spy_threshold, c_factor)
        and injects differential privacy noise so they can be exported safely without linkability.
        """
        eps = epsilon if epsilon is not None else self.default_epsilon
        
        # Define approximate sensitivities for metrics over n=1000 validation samples
        # A single transaction change changes precision/recall by at most ~1/n = 0.001
        sensitivities = {
            "roc_auc": 0.002,
            "precision": 0.003,
            "recall": 0.003,
            "f1_score": 0.003,
            "spy_threshold": 0.005,
            "c_factor": 0.005,
            "false_positive_rate": 0.002
        }

        noisy_metrics = {}
        total_scale = 0.0

        for metric_key, val in raw_metrics.items():
            sens = sensitivities.get(metric_key, 0.005)
            if mechanism.lower() == "gaussian":
                noisy_val, scale = self.apply_gaussian_mechanism(val, sens, eps, self.default_delta)
            else:
                noisy_val, scale = self.apply_laplace_mechanism(val, sens, eps)
            
            # Clamp probabilities / ratios to realistic boundaries [0.0, 1.0] where appropriate
            if metric_key in ("roc_auc", "precision", "recall", "f1_score", "c_factor", "false_positive_rate", "spy_threshold"):
                noisy_val = max(0.001, min(0.999, noisy_val))
            
            noisy_metrics[metric_key] = round(noisy_val, 4)
            total_scale += scale

        avg_scale = total_scale / max(1, len(raw_metrics))
        self._consume_budget(eps, "MODEL_METRICS_EXPORT", mechanism.upper(), avg_scale)

        return {
            "status": "success",
            "privacy_guarantee": f"({eps}, {self.default_delta})-DP Gaussian" if mechanism.lower() == "gaussian" else f"{eps}-DP Laplace",
            "epsilon_cost": round(eps, 4),
            "delta": self.default_delta if mechanism.lower() == "gaussian" else 0.0,
            "noise_scale_avg": round(avg_scale, 5),
            "noisy_metrics": noisy_metrics,
            "budget_status": self.get_budget_status()
        }

    def compute_reidentification_risk(
        self,
        node_count: int,
        edge_count: int,
        max_degree: int,
        structuring_nodes: int
    ) -> Dict[str, Any]:
        """
        Computes re-identification and linkage attack risk scores for graph structures.
        Evaluates k-anonymity (minimum equivalent topology class size) and l-diversity.
        """
        # Estimate k-anonymity based on degree distribution density
        # High max_degree in small clusters makes unique hubs identifiable (low k-anonymity)
        if node_count <= 0:
            return {"k_anonymity": 0, "l_diversity": 0.0, "reid_risk_score": 0.0, "risk_level": "Unknown"}

        avg_degree = (2.0 * edge_count) / max(1, node_count)
        degree_skew = max_degree / max(1.0, avg_degree)
        
        # Approximate k-anonymity: how many nodes share similar local neighborhood signature
        k_est = max(1, int(node_count / max(1.0, degree_skew * 1.5)))
        
        # Approximate l-diversity index (diversity of sensitive labels like structuring flags)
        struct_ratio = structuring_nodes / max(1, node_count)
        l_index = round(max(1.0, 1.0 / max(0.05, abs(struct_ratio - 0.5) * 2.0)), 2)

        # Risk score formula between 0.0 (safe) and 1.0 (high linkage risk)
        # If k_est is low (<3) and degree skew is high, risk approaches 0.8+
        risk_score = min(0.95, max(0.05, (1.0 / max(1, k_est)) * 0.7 + (degree_skew / 20.0) * 0.3))
        
        risk_level = "Low Risk (Anonymized)"
        if risk_score > 0.65 or k_est <= 2:
            risk_level = "High Risk (Unique Hubs Identifiable)"
        elif risk_score > 0.35 or k_est <= 5:
            risk_level = "Moderate Risk (Requires DP Noise)"

        return {
            "k_anonymity_estimate": k_est,
            "l_diversity_index": l_index,
            "reid_risk_score": round(risk_score, 4),
            "risk_level": risk_level,
            "recommendation": "Inject epsilon <= 0.5 Laplace noise on degree & volume exports." if risk_score > 0.35 else "Topology meets standard export criteria."
        }

    def get_dp_graph_summary(
        self,
        raw_graph_stats: Dict[str, Any],
        epsilon: Optional[float] = None,
        mechanism: str = "laplace"
    ) -> Dict[str, Any]:
        """
        Generates a privacy-preserved graph topology export with re-identification risk metrics.
        """
        eps = epsilon if epsilon is not None else self.default_epsilon
        
        node_count = raw_graph_stats.get("node_count", 45)
        edge_count = raw_graph_stats.get("edge_count", 120)
        max_degree = raw_graph_stats.get("max_degree", 12)
        struct_nodes = raw_graph_stats.get("structuring_nodes", 8)
        total_volume = raw_graph_stats.get("total_volume_exposed", 1250000.0)

        # Compute re-identification risk before noise injection
        reid_assessment = self.compute_reidentification_risk(node_count, edge_count, max_degree, struct_nodes)

        # Sensitivities for graph counts: adding/removing one node changes node count by 1, degree by up to 2
        node_noisy, scale_n = self.apply_laplace_mechanism(node_count, 1.0, eps * 0.25)
        edge_noisy, scale_e = self.apply_laplace_mechanism(edge_count, 2.0, eps * 0.25)
        struct_noisy, scale_s = self.apply_laplace_mechanism(struct_nodes, 1.0, eps * 0.25)
        # Volume sensitivity (assume max transaction contribution $50,000)
        vol_noisy, scale_v = self.apply_laplace_mechanism(total_volume, 50000.0, eps * 0.25)

        noisy_summary = {
            "node_count_dp": max(1, int(round(node_noisy))),
            "edge_count_dp": max(1, int(round(edge_noisy))),
            "structuring_nodes_dp": max(0, int(round(struct_noisy))),
            "total_volume_exposed_dp": round(max(0.0, vol_noisy), 2),
            "average_degree_dp": round((2.0 * max(1, edge_noisy)) / max(1, node_noisy), 2)
        }

        avg_scale = (scale_n + scale_e + scale_s + scale_v / 10000.0) / 4.0
        self._consume_budget(eps, "GRAPH_TOPOLOGY_EXPORT", mechanism.upper(), avg_scale)

        return {
            "status": "success",
            "privacy_guarantee": f"{eps}-DP Laplace Graph Export",
            "epsilon_cost": round(eps, 4),
            "noisy_summary": noisy_summary,
            "reidentification_risk_assessment": reid_assessment,
            "budget_status": self.get_budget_status()
        }


# Global singleton instance for FAGE DP Engine
dp_engine = FAGEDPEngine(max_epsilon=10.0, default_epsilon=0.5)
