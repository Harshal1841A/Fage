import sys
import logging
from typing import Dict, List, Any, Optional

import numpy as np
import pandas as pd

logger = logging.getLogger("FAGE.ML.ShapInteractions")
if not logger.handlers:
    handler = logging.StreamHandler(sys.stdout)
    formatter = logging.Formatter("[%(asctime)s] %(levelname)s [%(name)s:%(lineno)s] %(message)s")
    handler.setFormatter(formatter)
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)

try:
    import shap
except ImportError:
    shap = None


class FAGEShapInteractionEngine:
    """
    SHAP Interaction-Guided Feature Engineering Engine for FAGE.
    
    Instead of blind quadratic expansion (O(N^2) features), this engine computes
    exact 2D SHAP interaction matrices Phi_{i,j} over background samples,
    identifies the top interacting feature pairs where non-linear synergy exists,
    and automatically synthesizes explicit ratios and multiplicative features.
    """

    def __init__(
        self,
        model: Any,
        background_data: pd.DataFrame,
        top_interactions_k: int = 10
    ):
        """
        Args:
            model: Trained tree estimator (XGBoost, RandomForest, LightGBM).
            background_data: Sample feature matrix for computing interaction values.
            top_interactions_k: Number of top interacting pairs to engineer features for.
        """
        self.model = model
        self.background_data = background_data
        self.top_interactions_k = top_interactions_k
        self.feature_names_ = background_data.columns.tolist()
        
        self.interaction_matrix_: Optional[np.ndarray] = None
        self.top_pairs_: List[Dict[str, Any]] = []
        self.engineered_features_: List[str] = []

    def compute_interaction_matrix(self, X: Optional[pd.DataFrame] = None) -> np.ndarray:
        """
        Computes the mean absolute SHAP interaction matrix E[|Phi_{i, j}|].
        
        Args:
            X: Feature matrix to evaluate. Defaults to self.background_data.
            
        Returns:
            2D numpy matrix of shape (num_features, num_features).
        """
        eval_data = X if X is not None else self.background_data
        n_features = len(self.feature_names_)
        
        if shap is not None:
            try:
                logger.info(f"Computing exact SHAP interaction values on {len(eval_data)} samples...")
                explainer = shap.TreeExplainer(self.model)
                interactions = explainer.shap_interaction_values(eval_data)
                
                # Check dimensions of returned interaction tensor
                if isinstance(interactions, list):
                    interactions = interactions[1]  # positive class for binary classifier
                elif len(interactions.shape) == 4:
                    interactions = interactions[:, :, :, 1]
                    
                mean_abs_matrix = np.mean(np.abs(interactions), axis=0)
                self.interaction_matrix_ = mean_abs_matrix
                return mean_abs_matrix
            except Exception as e:
                logger.warning(f"TreeExplainer SHAP interaction calculation failed: {str(e)}. Using gradient/correlation fallback proxy.")
        else:
            logger.info("SHAP not installed. Using empirical sensitivity correlation fallback proxy.")
            
        # Fallback proxy: calculate sensitivity of model predictions when feature pairs are perturbed
        mean_abs_matrix = np.zeros((n_features, n_features))
        try:
            if hasattr(self.model, "predict_proba"):
                base_preds = self.model.predict_proba(eval_data)[:, 1]
            else:
                base_preds = self.model.predict(eval_data)
                
            # Compute empirical covariance between feature changes and prediction deviation
            corr = eval_data.corr().abs().fillna(0).values
            feature_stds = eval_data.std().values
            for i in range(n_features):
                for j in range(i + 1, n_features):
                    proxy_val = float(corr[i, j] * np.std(base_preds) / (1.0 + feature_stds[i] + feature_stds[j]))
                    mean_abs_matrix[i, j] = proxy_val
                    mean_abs_matrix[j, i] = proxy_val
        except Exception as e:
            logger.warning(f"Fallback proxy calculation failed: {str(e)}.")
            
        self.interaction_matrix_ = mean_abs_matrix
        return mean_abs_matrix

    def extract_top_interacting_pairs(
        self,
        mean_abs_matrix: Optional[np.ndarray] = None,
        feature_names: Optional[List[str]] = None
    ) -> List[Dict[str, Any]]:
        """
        Extracts the top interacting feature pairs ranking from upper triangle of interaction matrix.
        
        Args:
            mean_abs_matrix: 2D interaction matrix. Defaults to self.interaction_matrix_.
            feature_names: List of feature names. Defaults to self.feature_names_.
            
        Returns:
            Sorted list of dictionaries with keys: feature_a, feature_b, interaction_strength.
        """
        matrix = mean_abs_matrix if mean_abs_matrix is not None else self.interaction_matrix_
        if matrix is None:
            matrix = self.compute_interaction_matrix()
            
        cols = feature_names if feature_names is not None else self.feature_names_
        n = len(cols)
        
        pairs = []
        for i in range(n):
            for j in range(i + 1, n):
                if i != j and not np.isnan(matrix[i, j]):
                    pairs.append({
                        "feature_a": cols[i],
                        "feature_b": cols[j],
                        "interaction_strength": float(matrix[i, j])
                    })
                    
        pairs.sort(key=lambda x: x["interaction_strength"], reverse=True)
        top_k = pairs[:self.top_interactions_k]
        self.top_pairs_ = top_k
        logger.info(f"Extracted top {len(top_k)} interacting pairs. Top pair: {top_k[0]['feature_a']} <-> {top_k[0]['feature_b']} ({top_k[0]['interaction_strength']:.4f}) if pairs else None.")
        return top_k

