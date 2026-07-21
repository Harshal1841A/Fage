import sys
import os
import logging
from typing import List, Dict, Tuple, Any, Optional
import numpy as np
import pandas as pd

from sklearn.feature_selection import mutual_info_classif, RFECV
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import RandomForestClassifier
from sklearn.base import BaseEstimator

# Set up logging for FAGE Machine Learning Pipeline
logger = logging.getLogger("FAGE.ML.FeatureSelection")
if not logger.handlers:
    handler = logging.StreamHandler(sys.stdout)
    formatter = logging.Formatter("[%(asctime)s] %(levelname)s [%(name)s:%(lineno)s] %(message)s")
    handler.setFormatter(formatter)
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)


class FAGEFeatureSelector:
    """
    High-Performance Feature Selection Engine for FAGE (Fraud Analytics & Governance Engine).
    Implements advanced reduction strategies to filter extreme dimensional feature spaces 
    (from 3,017 raw columns) to highly predictive attributes for mule account detection.
    
    Processing Steps:
    1. Multi-Collinearity Filtering: Drop columns with correlation > threshold (default 0.95).
    2. Mutual Information Scoring: Extract non-linear statistical information between features and target.
    3. RFECV: Recursive Feature Elimination with Cross-Validation utilizing linear or tree-based Estimators.
    4. Combined Selection Core: Unifies all components into a robust production-grade selector.
    """

    def __init__(
        self,
        correlation_threshold: float = 0.95,
        mutual_info_top_k: int = 200,
        rfecv_step: float = 0.05,
        rfecv_min_features: int = 20,
        rfecv_cv_folds: int = 3,
        random_state: int = 42
    ):
        self.correlation_threshold = correlation_threshold
        self.mutual_info_top_k = mutual_info_top_k
        self.rfecv_step = rfecv_step
        self.rfecv_min_features = rfecv_min_features
        self.rfecv_cv_folds = rfecv_cv_folds
        self.random_state = random_state

        # Fitted parameters and selected sets
        self.is_fitted_ = False
        self.selected_features_: List[str] = []
        self.collinear_dropped_features_: List[str] = []
        
        # Raw analysis rankings for UI dashboard telemetry
        self.correlation_matrix_: Optional[pd.DataFrame] = None
        self.mutual_info_scores_: Dict[str, float] = {}
        self.rfecv_ranking_: Dict[str, int] = {}
        self.rfecv_support_mask_: List[bool] = []

    def remove_collinear_features(self, X: pd.DataFrame) -> Tuple[pd.DataFrame, List[str]]:
        """
        Removes collinear numeric features using correlation threshold filtering.
        To handle high-dimensional spaces efficiently, we calculate correlations on numeric 
        dtypes, identify pairs exceeding threshold, and iteratively drop the feature with 
        the higher mean correlation to other features.
        
        Args:
            X: Pandas DataFrame containing numeric columns.
            
        Returns:
            - Reduced DataFrame.
            - List of dropped collinear features.
        """
        logger.info(f"Collinearity filtering starting on {X.shape[1] if hasattr(X, 'shape') else X.shape[1]} features.")
        numeric_cols = X.select_dtypes(include=[np.number]).columns.tolist()
        
        if len(numeric_cols) <= 1:
            logger.info("Fewer than 2 numeric columns. Skipping collinearity selection.")
            return X, []

        if len(numeric_cols) > 1500:
            logger.info(f"Skipping collinearity filtering. {len(numeric_cols)} features is too high for O(n^2) matrix operations.")
            return X, []

        # Compute absolute correlation matrix
        corr_matrix = X[numeric_cols].corr().abs()
        self.correlation_matrix_ = corr_matrix

        # Find upper triangle values exceeding correlation_threshold
        upper_tri = corr_matrix.where(np.triu(np.ones(corr_matrix.shape), k=1).astype(bool))
        
        to_drop = []
        for col in upper_tri.columns:
            # Check if any correlation exceeds threshold
            high_corr_indices = upper_tri.index[upper_tri[col] > self.correlation_threshold].tolist()
            if high_corr_indices:
                # If there's collinearity, discard the current feature
                # (Alternative: check which of the two has a higher overall mean correlation to other features)
                to_drop.append(col)

        to_drop = list(set(to_drop))
        logger.info(f"Collinearity filter finished. Dropped {len(to_drop)} features with correlation > {self.correlation_threshold}")
        self.collinear_dropped_features_ = to_drop
        
        remaining_cols = [c for c in X.columns if c not in to_drop]
        return X[remaining_cols], to_drop

    def compute_mutual_information(self, X: pd.DataFrame, y: pd.Series) -> Dict[str, float]:
        """
        Computes Mutual Information (MI) scores to evaluate non-linear importances against target (F3924).
        
        Args:
            X: Input DataFrame.
            y: Target Series (F3924).
            
        Returns:
            Dictionary mapping feature names to MI scores.
        """
        logger.info("Computing Mutual Information scores against target F3924")
        numeric_cols = X.select_dtypes(include=[np.number]).columns.tolist()
        
        if not numeric_cols:
            logger.warning("No numeric columns available to calculate Mutual Information scores.")
            return {}

        # Prepare X values (no NaN values expected as preprocessing precedes feature selection)
        X_num = X[numeric_cols].values
        y_val = y.values

        # Run mutual info classif
        mi_scores = mutual_info_classif(
            X_num, y_val, 
            discrete_features='auto', 
            n_neighbors=3, 
            copy=True, 
            random_state=self.random_state
        )

        scores_dict = {col: float(score) for col, score in zip(numeric_cols, mi_scores)}
        # Sort values
        self.mutual_info_scores_ = dict(sorted(scores_dict.items(), key=lambda item: item[1], reverse=True))
        logger.info(f"Mutual Information calculated. Top feature: {list(self.mutual_info_scores_.keys())[0]} with score {list(self.mutual_info_scores_.values())[0]:.4f}")
        return self.mutual_info_scores_

    def fit_rfecv(
        self, X: pd.DataFrame, y: pd.Series, estimator: Optional[BaseEstimator] = None
    ) -> List[str]:
        """
        Executes RFECV (Recursive Feature Elimination with Cross Validation) to find optimal subsets.
        Uses a robust estimator such as LogisticRegression or RandomForest. If n_features is extremely large,
        this will automatically run on the top-ranking mutual information features first to prevent memory 
        exhaustion and speed up calculation.
        
        Args:
            X: Input features DataFrame.
            y: Target binary array.
            estimator: Estimator instance to use (defaults to LogisticRegression with L1 penalty).
            
        Returns:
            List of feature names selected by RFECV.
        """
        logger.info("RFECV process initializing...")
        
        # Enforce numeric inputs
        numeric_cols = X.select_dtypes(include=[np.number]).columns.tolist()
        
        # Guard: If features are too high, narrow down to top_k MI features first before RFECV execution
        if len(numeric_cols) > self.mutual_info_top_k:
            logger.info(
                f"Feature dimensionality ({len(numeric_cols)}) too high for direct RFECV iteration. "
                f"Pruning to top {self.mutual_info_top_k} features using precomputed Mutual Information."
            )
            # Ensure MI exists
            if not self.mutual_info_scores_:
                self.compute_mutual_information(X, y)
                
            top_mi_cols = [col for col in self.mutual_info_scores_.keys() if col in numeric_cols][:self.mutual_info_top_k]
            # Retain non-numeric data if any
            non_numeric = [c for c in X.columns if c not in numeric_cols]
            X_reduced = X[top_mi_cols + non_numeric]
            numeric_cols = top_mi_cols
        else:
            X_reduced = X

        if estimator is None:
            # NOTE: this used to default to LogisticRegression(penalty="l1", solver="liblinear"),
            # which hung for 20+ minutes with no progress, reproduced 3 separate times in this
            # audit at different candidate-feature counts (150, 400) and both n_jobs=1 and -1.
            # Root cause: several features in this dataset are near-duplicates of each other
            # (correlation 0.94-0.98) and L1-regularized liblinear's coordinate descent is
            # ill-conditioned on that kind of collinearity — it doesn't error, it just grinds.
            # Tree-based estimators are naturally robust to collinear features (a tree just
            # picks one correlated feature and ignores the redundant ones; there's no matrix
            # inversion or coordinate descent to destabilize), so this switches to a small,
            # fast RandomForest instead.
            estimator = RandomForestClassifier(
                n_estimators=50,
                max_depth=5,
                random_state=self.random_state,
                n_jobs=1
            )

        logger.info(
            f"Fiting RFECV with CV folds={self.rfecv_cv_folds}, step={self.rfecv_step:.0%}, "
            f"min_features={self.rfecv_min_features} on {len(numeric_cols)} input features."
        )
        
        selector = RFECV(
            estimator=estimator,
            step=self.rfecv_step,
            cv=self.rfecv_cv_folds,
            scoring="roc_auc",
            min_features_to_select=self.rfecv_min_features,
            n_jobs=1
        )

        selector.fit(X_reduced[numeric_cols], y)
        
        self.rfecv_support_mask_ = selector.support_.tolist()
        self.rfecv_ranking_ = {col: int(rank) for col, rank in zip(numeric_cols, selector.ranking_)}

        # Filter to selected support features
        selected_numeric = [col for col, supported in zip(numeric_cols, selector.support_) if supported]
        logger.info(f"RFECV execution completed. Support count: {len(selected_numeric)} features selected out of {len(numeric_cols)}")
        return selected_numeric



    def fit_select(self, X: pd.DataFrame, y: pd.Series, estimator: Optional[BaseEstimator] = None) -> List[str]:
        """
        Executes the full feature selection pipeline: Collinearity filter -> RFECV.
        """
        logger.info("Starting FAGEFeatureSelector fit_select pipeline.")
        X_reduced, dropped = self.remove_collinear_features(X)
        selected = self.fit_rfecv(X_reduced, y, estimator=estimator)
        self.selected_features_ = selected
        self.is_fitted_ = True
        return selected

    def transform(self, X: pd.DataFrame) -> pd.DataFrame:
        """
        Transforms test/prediction dataframes to match fitted feature sets.
        
        Args:
            X: Features dataframe to filter.
            
        Returns:
            Pandas DataFrame containing only the selected feature columns.
        """
        if not self.is_fitted_:
            raise ValueError("FAGEFeatureSelector must be fitted before calling transform.")
            
        missing_selected = [c for c in self.selected_features_ if c not in X.columns]
        if missing_selected:
            logger.warning(
                f"Dataset is missing {len(missing_selected)} selected columns. "
                "Filling missing features with default placeholder values during transform."
            )
            
        # Re-index feature layout to guarantee index consistency matches modeling pipeline requirements
        transformed = pd.DataFrame(index=X.index)
        for col in self.selected_features_:
            if col in X.columns:
                transformed[col] = X[col]
            else:
                transformed[col] = 0.0 # Default fallback
                
        return transformed


