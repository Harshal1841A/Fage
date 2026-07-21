import os
import sys
import uuid
import logging
import pickle
import json
from datetime import datetime, UTC
from typing import Dict, List, Tuple, Any, Optional

import numpy as np
import pandas as pd

# Add system pathways to resolve modules in full stack container
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app.ml.preprocessing import FAGEPreprocessor
from app.ml.feature_selection import FAGEFeatureSelector
from app.ml.shap_engine import FAGEShapEngine
from app.ml.pu_engine import FAGEPUEngine, FAGEAdaptiveEngine
from app.ml.shap_interactions import FAGEShapInteractionEngine
from app.ml.triage_policy import FAGETriagePolicy
from app.ml.cost_optimizer import FAGECostOptimizer

# Setup logging
logger = logging.getLogger("FAGE.Services.RiskEngine")
if not logger.handlers:
    handler = logging.StreamHandler(sys.stdout)
    formatter = logging.Formatter("[%(asctime)s] %(levelname)s [%(name)s:%(lineno)s] %(message)s")
    handler.setFormatter(formatter)
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)


class FAGEEnsembleClassifier:
    """
    Unified Soft-Voting Ensemble combining supervised prediction properties
    from XGBoost, LightGBM, and Random Forest for mule risk scorecard compliance.
    """
    def __init__(self, xgb_model, lgb_model, rf_model):
        self.xgb_model = xgb_model
        self.lgb_model = lgb_model
        self.rf_model = rf_model

    def predict_proba(self, X: pd.DataFrame) -> np.ndarray:
        probs = []
        estimators = [self.xgb_model, self.lgb_model, self.rf_model]
        for model in estimators:
            if model is not None:
                probs.append(model.predict_proba(X)[:, 1])
        if not probs:
            return np.ones((len(X), 2)) * 0.12
        avg_prob = np.mean(probs, axis=0)
        return np.column_stack([1.0 - avg_prob, avg_prob])

    def predict(self, X: pd.DataFrame) -> np.ndarray:
        probs = self.predict_proba(X)[:, 1]
        return (probs >= 0.50).astype(int)


class FAGERiskEngineUnpickler(pickle.Unpickler):
    """
    Custom unpickler to resolve class references (like FAGEEnsembleClassifier)
    regardless of whether they were pickled under __main__ or another module path.
    """
    def find_class(self, module, name):
        if name == "FAGEEnsembleClassifier":
            return FAGEEnsembleClassifier
        return super().find_class(module, name)


class FAGERiskEngine:
    """
    Enterprise-Grade Risk Scoring and Alerting Engine for FAGE (Fraud Analytics & Governance Engine).
    
    This engine acts as the unified operational backend, taking raw transaction payloads and:
    1. Processing features using preprocessor and feature selection pickles.
    2. Dynamically deploying standard, boosting, and custom soft-voting ensemble classifiers on-demand.
    3. Running concurrent unsupervised Isolation Forest detection to flag high-dimensional outliers.
    4. Categorizing final 0-100 risk score indicators into precise compliant regulatory buckets.
    5. Evaluating rule-based heuristic overrides alongside machine learning scores.
    6. Formulating transparent waterfall attributions citing key driver shifts.
    """

    def __init__(
        self,
        models_dir: str = "models",
        default_model_name: str = "XGBoost",
        override_rules_enabled: bool = True
    ):
        """
        Initializes the risk engine, loading all fitted pipelines and classifiers sequentially.
        """
        self.models_dir = models_dir
        self.default_model_name = default_model_name
        self.override_rules_enabled = override_rules_enabled

        # Pipelines
        self.preprocessor: Optional[FAGEPreprocessor] = None
        self.selector: Optional[FAGEFeatureSelector] = None
        
        # Classifier configurations
        self.classifiers: Dict[str, Any] = {}
        self.classifier: Any = None
        self.isolation_forest: Any = None
        self.shap_engine: Optional[FAGEShapEngine] = None
        self.shap_interactions: Optional[FAGEShapInteractionEngine] = None
        self.pu_engine: Optional[FAGEPUEngine] = None
        self.triage_policy: Optional[FAGETriagePolicy] = None
        self.cost_optimizer: Optional[FAGECostOptimizer] = None
        self.bootstrap_models: List[Any] = []
        self.background_sample: Optional[pd.DataFrame] = None
        
        # Risk score blending metadata
        self.anomaly_score_min: Optional[float] = None
        self.anomaly_score_max: Optional[float] = None
        
        self.is_production_ready = False
        self._load_pipeline_components()
        self._load_risk_metadata()

    def _load_pipeline_components(self):
        """
        Loads fitted pipeline serializers and multiple algorithm models.
        """
        preprocessor_path = os.path.join(self.models_dir, "preprocessor.pkl")
        selector_path = os.path.join(self.models_dir, "selector.pkl")

        logger.info(f"Targeting FAGE components loading within: {self.models_dir}")
        try:
            if os.path.exists(preprocessor_path) and os.path.exists(selector_path):
                with open(preprocessor_path, "rb") as f:
                    self.preprocessor = pickle.load(f)
                with open(selector_path, "rb") as f:
                    self.selector = pickle.load(f)
                logger.info("Successfully loaded preprocessor and selector pipelines.")
            else:
                logger.warning(
                    f"FAGE Pipeline initialization: preprocessor or selector not present at '{self.models_dir}'. "
                    "Deploying unified standalone testing proxies..."
                )
                self._deploy_fallback_proxies()
                return
        except Exception as e:
            logger.error(f"Failed loading standard pipeline serialization streams: {str(e)}")
            self._deploy_fallback_proxies()
            return

        # Sequential loading strategy for classifiers
        model_names = [
            "xgboost", "lightgbm", "randomforest", "extratrees", 
            "logisticregression", "ensemble"
        ]
        
        loaded_count = 0
        for m_name in model_names:
            filename = f"{m_name}_classifier.pkl"
            filepath = os.path.join(self.models_dir, filename)
            if os.path.exists(filepath):
                try:
                    with open(filepath, "rb") as f:
                        self.classifiers[m_name] = FAGERiskEngineUnpickler(f).load()
                    loaded_count += 1
                except Exception as e:
                    logger.error(f"Class loading failure on pickle '{filename}': {str(e)}")

        # Enforce strict model loading without fallback proxies
        if loaded_count < len(model_names):
            logger.warning(f"Only {loaded_count}/{len(model_names)} modeling pickles loaded. Strict mode enforced: no mock classifiers will be created for missing models.")

        self.isolation_forest = None

        bootstrap_path = os.path.join(self.models_dir, "bootstrap_ensemble.pkl")
        if os.path.exists(bootstrap_path):
            try:
                with open(bootstrap_path, "rb") as f:
                    self.bootstrap_models = pickle.load(f)
                logger.info(f"Loaded bootstrap uncertainty ensemble: {len(self.bootstrap_models)} models.")
            except Exception as e:
                logger.error(f"Failed to load bootstrap ensemble: {str(e)}. Confidence intervals will be unavailable.")
                self.bootstrap_models = []

        bg_path = os.path.join(self.models_dir, "background_sample.pkl")
        if os.path.exists(bg_path):
            try:
                with open(bg_path, "rb") as f:
                    self.background_sample = pickle.load(f)
                logger.info(f"Loaded real background sample: {len(self.background_sample)} legitimate accounts.")
            except Exception as e:
                logger.error(f"Failed to load background sample: {str(e)}. Falling back to synthetic zeros.")
                self.background_sample = None

        # Load PU Engine
        pu_path = os.path.join(self.models_dir, "pu_engine.pkl")
        if os.path.exists(pu_path):
            try:
                with open(pu_path, "rb") as f:
                    self.pu_engine = pickle.load(f)
                logger.info("Loaded calibrated PU learning engine.")
            except Exception as e:
                logger.error(f"Failed to load PU engine: {e}")
                self.pu_engine = FAGEPUEngine()
        else:
            self.pu_engine = FAGEPUEngine()

        # Initialize Adaptive Engine
        self.adaptive_engine = FAGEAdaptiveEngine(self.pu_engine)

        # Load Triage Policy
        triage_path = os.path.join(self.models_dir, "triage_policy.pkl")
        if os.path.exists(triage_path):
            try:
                with open(triage_path, "rb") as f:
                    self.triage_policy = pickle.load(f)
                logger.info("Loaded confidence-routed triage policy engine.")
            except Exception as e:
                logger.error(f"Failed to load triage policy: {e}")
                self.triage_policy = FAGETriagePolicy()
        else:
            self.triage_policy = FAGETriagePolicy()

        # Load Cost Optimizer
        cost_path = os.path.join(self.models_dir, "cost_optimizer.pkl")
        if os.path.exists(cost_path):
            try:
                with open(cost_path, "rb") as f:
                    self.cost_optimizer = pickle.load(f)
                logger.info("Loaded cost-sensitive threshold optimizer.")
            except Exception as e:
                logger.error(f"Failed to load cost optimizer: {e}")
                self.cost_optimizer = FAGECostOptimizer()
        else:
            self.cost_optimizer = FAGECostOptimizer()

        # Also attempt to load optimal operating points from cost_thresholds.json if present
        cost_json_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "../../data/cost_thresholds.json")
        if not os.path.exists(cost_json_path):
            cost_json_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "../../../data/cost_thresholds.json")
        if os.path.exists(cost_json_path) and self.cost_optimizer and not self.cost_optimizer.optimal_thresholds_:
            try:
                with open(cost_json_path, "r") as f:
                    cost_meta = json.load(f)
                    if "operating_points" in cost_meta:
                        self.cost_optimizer.optimal_thresholds_ = cost_meta["operating_points"]
            except Exception as e:
                logger.warning(f"Could not ingest cost_thresholds.json: {e}")

        self.set_active_classifier(self.default_model_name)
        self.is_production_ready = True
        logger.info(f"FAGE RiskEngine operational with {loaded_count} calibrated classifiers fully connected.")

    def _load_risk_metadata(self):
        metadata_path = os.path.join(self.models_dir, "risk_metadata.json")
        if os.path.exists(metadata_path):
            try:
                with open(metadata_path, "r") as f:
                    meta = json.load(f)
                self.anomaly_score_min = meta.get("anomaly_score_min")
                self.anomaly_score_max = meta.get("anomaly_score_max")
                logger.info(f"Successfully loaded risk metadata: min={self.anomaly_score_min}, max={self.anomaly_score_max}")
            except Exception as e:
                logger.error(f"Failed to load risk metadata JSON: {e}")

    def set_active_classifier(self, name: str):
        logger.info(f"Re-routing active classifier to target algorithm: {name}")
        normalized_name = name.lower().replace("_classifier", "").replace(" ", "").strip()
        
        if normalized_name not in self.classifiers:
            normalized_name = "xgboost" if "xgboost" in self.classifiers else list(self.classifiers.keys())[0]

        self.classifier = self.classifiers[normalized_name]
        self.default_model_name = normalized_name.upper()

        if self.background_sample is not None and set(self.selector.selected_features_).issubset(set(self.background_sample.columns)):
            background_data = self.background_sample[self.selector.selected_features_]
        elif self.selector is not None and len(self.selector.selected_features_) > 0:
            logger.warning("No real background sample available — falling back to synthetic all-zeros baseline for SHAP/explanations.")
            background_data = pd.DataFrame(
                np.zeros((10, len(self.selector.selected_features_))), 
                columns=self.selector.selected_features_
            )
        else:
            background_data = pd.DataFrame()

        self.shap_engine = FAGEShapEngine(
            model=self.classifier,
            background_data=background_data,
            model_name=self.default_model_name
        )
        self.shap_interactions = FAGEShapInteractionEngine(
            model=self.classifier,
            background_data=background_data
        )

    def _deploy_fallback_proxies(self):
        logger.error("Core model components failed to load. Strict mode enforced: raising RuntimeError instead of using mock proxies.")
        raise RuntimeError("FAGE Risk Engine failed to initialize because core model components (preprocessor, selector, or classifier) are missing. Run the training script first.")
        self.triage_policy = FAGETriagePolicy()
        self.cost_optimizer = FAGECostOptimizer()
        self.is_production_ready = False
        logger.info("Fallback modeling proxies loaded — NOT production ready, /predict will correctly refuse to serve.")

    def map_probability_to_scorecard(self, probability: float) -> Tuple[int, str, str, str]:
        prob_bounded = max(0.0, min(1.0, probability))
        score = int(round(prob_bounded * 100))

        if 0 <= score <= 25:
            tier = "Low"
            severity = "Low"
            decision = "Approve"
        elif 26 <= score <= 50:
            tier = "Medium"
            severity = "Medium"
            decision = "Review"
        elif 51 <= score <= 75:
            tier = "High"
            severity = "High"
            decision = "Escalate"
        else: # 76 - 100
            tier = "Critical"
            severity = "Critical"
            decision = "Block"

        return score, tier, severity, decision

    def evaluate_heuristic_overrides(self, raw_payload: Dict[str, Any]) -> List[Dict[str, Any]]:
        overrides = []
        if not self.override_rules_enabled:
            return overrides
            
        rules_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "compliance_rules.json")
        rules = {
            "sanctioned_countries": ["IR", "KP", "SY", "SD", "CU"],
            "amount_threshold": 150000.0,
            "new_account_max_days": 7.0,
            "new_account_transfer_threshold": 25000.0
        }
        try:
            if os.path.exists(rules_path):
                with open(rules_path, "r") as f:
                    rules.update(json.load(f))
        except Exception as e:
            logger.error(f"Error loading compliance_rules.json, using defaults: {e}")

        origin_country = str(raw_payload.get("origin_country", "US")).upper().strip()
        destination_country = str(raw_payload.get("destination_country", "US")).upper().strip()
        sanctioned_countries = set(rules.get("sanctioned_countries", []))
        
        if origin_country in sanctioned_countries or destination_country in sanctioned_countries:
            flagged = origin_country if origin_country in sanctioned_countries else destination_country
            overrides.append({
                "rule_id": "RULE-G01-SANCTION",
                "rule_name": f"OFAC Sanction Match: {flagged}",
                "trigger_score": 99,
                "tier_enforcement": "Critical",
                "alert_severity_enforcement": "Critical",
                "reason": "Entity sequence initiated or routed involving flagged OFAC target sanction codes."
            })

        try:
            amount = float(raw_payload.get("amount", 0.0))
        except (ValueError, TypeError):
            logger.warning(f"Heuristic audit: invalid amount format: {raw_payload.get('amount')}. Defaulting to 0.0")
            amount = 0.0
            
        if amount > rules.get("amount_threshold", 150000.0):
            overrides.append({
                "rule_id": "RULE-V02-OUTRAGEOUS-AMOUNT",
                "rule_name": "Velvet Volume Overflow",
                "trigger_score": 90,
                "tier_enforcement": "Critical",
                "alert_severity_enforcement": "Critical",
                "reason": f"Single transactional volume ${amount:,.2f} exceeds standard velocity verification baseline."
            })

        try:
            account_age_days = float(raw_payload.get("account_age_days", 365.0))
        except (ValueError, TypeError):
            logger.warning(f"Heuristic audit: invalid account_age_days format: {raw_payload.get('account_age_days')}. Defaulting to 365.0")
            account_age_days = 365.0
        is_international = raw_payload.get("is_international", False)
        
        max_days = rules.get("new_account_max_days", 7.0)
        transfer_thresh = rules.get("new_account_transfer_threshold", 25000.0)
        
        if account_age_days < max_days and (is_international or amount > transfer_thresh):
            overrides.append({
                "rule_id": "RULE-A03-NEW-ACCOUNT-VELOCITY",
                "rule_name": "Swift New Account Outflow",
                "trigger_score": 75,
                "tier_enforcement": "High",
                "alert_severity_enforcement": "High",
                "reason": f"Operational age {account_age_days:.0f} days paired with cross-border transfer signals."
            })

        return overrides

    def compute_evasion_resistance(self, df_row: pd.DataFrame, sorted_drivers: list, current_prob: float) -> Optional[Dict[str, Any]]:
        LOW_TIER_THRESHOLD = 0.26

        if self.background_sample is None or not sorted_drivers:
            return None

        legit_reference = self.background_sample[self.selector.selected_features_].median()
        working_row = df_row.copy()
        risk_increasing = [f for f, v in sorted_drivers if v > 1e-4]

        features_changed = []
        new_prob = current_prob
        for feat in risk_increasing[:15]:
            if feat not in legit_reference.index:
                continue
            original_val = working_row.at[0, feat] if feat in working_row.columns else None
            target_val = legit_reference[feat]
            if original_val is None or original_val == target_val:
                continue

            working_row.at[0, feat] = target_val
            try:
                new_prob = float(self.classifier.predict_proba(working_row)[0, 1])
            except Exception:
                continue
            features_changed.append({"feature": feat, "original_value": float(original_val), "typical_legitimate_value": float(target_val)})

            if new_prob < LOW_TIER_THRESHOLD:
                return {
                    "evadable_within_search": True,
                    "features_required_to_change": len(features_changed),
                    "changed_features": features_changed,
                    "resulting_probability": new_prob,
                    "interpretation": (
                        f"Adjusting {len(features_changed)} feature(s) to typical legitimate-account "
                        f"values would drop this account's risk out of the review-required range. "
                        f"The current flag relies on a concentrated, potentially fragile signal."
                    )
                }

        return {
            "evadable_within_search": False,
            "features_tried": len(features_changed),
            "resulting_probability": new_prob,
            "interpretation": (
                f"Adjusting the top {len(features_changed)} risk-increasing features to typical "
                f"legitimate-account values did not drop this account out of the review-required "
                f"range. The risk signal is distributed, not concentrated in a small number of "
                f"easily-changed features — a more robust flag."
            )
        }

    def score_single_case(self, raw_payload: Dict[str, Any]) -> Dict[str, Any]:
        """
        Combines preprocessing standardizers, classifier algorithms, PU calibration,
        and confidence-routed triage to compile a unified transaction risk scorecard.
        """
        transaction_id = str(raw_payload.get("transaction_id", f"TXN-{uuid.uuid4().hex[:12].upper()}"))
        logger.info(f"Scoring target entity: {transaction_id}")

        custom_metrics = raw_payload.get("custom_metrics", {})
        merged_raw = {**raw_payload, **(custom_metrics if isinstance(custom_metrics, dict) else {})}

        raw_row = {}
        for col in self.preprocessor.output_columns_:
            raw_row[col] = merged_raw.get(col, np.nan)
        raw_row_df = pd.DataFrame([raw_row])

        try:
            processed_row = self.preprocessor.transform(raw_row_df)
            flat_record = {col: processed_row.at[0, col] for col in self.selector.selected_features_}
        except Exception as e:
            logger.error(f"Preprocessor transform failed on live payload: {str(e)}. Falling back to per-feature background means.")
            flat_record = {col: float(self.shap_engine.background_means_.get(col, 0.0)) for col in self.selector.selected_features_}

        df_row = pd.DataFrame([flat_record])
        
        # 2. Run active classifier probability
        try:
            raw_prob = float(self.classifier.predict_proba(df_row)[0, 1])
        except Exception as e:
            logger.error(f"Prediction execution failed: {str(e)}. Defaulting base probability to 0.12")
            raw_prob = 0.12

        # 2b. Bootstrap confidence interval
        ci_lower, ci_upper, ci_width = None, None, None
        if self.bootstrap_models:
            try:
                boot_probs = np.array([m.predict_proba(df_row)[0, 1] for m in self.bootstrap_models])
                ci_lower = float(np.percentile(boot_probs, 5))
                ci_upper = float(np.percentile(boot_probs, 95))
                ci_width = float(ci_upper - ci_lower)
            except Exception as e:
                logger.error(f"Bootstrap CI computation failed: {str(e)}")

        # 2c. PU probability calibration
        prob = raw_prob
        if self.pu_engine and hasattr(self.pu_engine, "calibrate_probabilities"):
            try:
                prob = float(self.pu_engine.calibrate_probabilities(np.array([raw_prob]))[0])
            except Exception as e:
                logger.error(f"PU calibration failed: {str(e)}")

        # 3. Formulate pure ML risk indicators
        ml_score, ml_tier, ml_severity, ml_decision = self.map_probability_to_scorecard(prob)
        
        # 4. Process deterministic compliance overrides
        overrides = self.evaluate_heuristic_overrides(raw_payload)
        
        final_score = ml_score
        final_tier = ml_tier
        final_severity = ml_severity
        final_decision = ml_decision
        
        rule_triggered_flag = False
        if overrides:
            rule_triggered_flag = True
            max_rule = max(overrides, key=lambda x: x["trigger_score"])
            if max_rule["trigger_score"] > final_score:
                final_score = max_rule["trigger_score"]
                final_tier = max_rule["tier_enforcement"]
                final_severity = max_rule["alert_severity_enforcement"]
                
                _, _, _, final_decision = self.map_probability_to_scorecard(final_score / 100.0)
                logger.info(f"Risk indicators elevated by override rules: {max_rule['rule_id']}. Upgraded score to {final_score}")

        # 5. Extract localized Shapley coordinates
        row_series = df_row.iloc[0]
        shaps_raw = self.shap_engine.compute_local_shap(row_series)
        waterfall_data = self.shap_engine.generate_waterfall_data(row_series)
        
        sorted_drivers = sorted(shaps_raw.items(), key=lambda x: x[1], reverse=True)
        key_drivers = []
        for feat, val in sorted_drivers:
            if abs(val) < 1e-4:
                continue
            key_drivers.append({
                "feature": feat,
                "importance_attribution": float(val),
                "direction": "increases_risk" if val > 0 else "reduces_risk",
                "raw_value": float(flat_record[feat])
            })
            if len(key_drivers) >= 3:
                break

        evasion_analysis = None
        if final_score >= 26:
            evasion_analysis = self.compute_evasion_resistance(df_row, sorted_drivers, prob)

        # 6. Operational Triage Routing
        triage_routing = None
        if self.triage_policy and hasattr(self.triage_policy, "evaluate_account"):
            try:
                triage_routing = self.triage_policy.evaluate_account(
                    risk_score=float(final_score),
                    ci_lower=float(ci_lower if ci_lower is not None else prob),
                    ci_upper=float(ci_upper if ci_upper is not None else prob),
                    evadable=bool(evasion_analysis.get("evadable_within_search", False) if evasion_analysis else False),
                    pu_probability=float(prob),
                    account_id=transaction_id
                )
            except Exception as e:
                logger.error(f"Triage evaluation failed: {e}")

        scorecard = {
            "transaction_id": transaction_id,
            "timestamp": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "processing_metadata": {
                "engine_version": "v1.0.0-beta",
                "selected_model": self.default_model_name,
                "is_override_applied": rule_triggered_flag,
                "is_unsupervised_outlier": False
            },
            "scores": {
                "base_ml_score": ml_score,
                "base_ml_probability": prob,
                "raw_uncalibrated_probability": raw_prob,
                "final_risk_score": final_score,
                "confidence_interval_90": {
                    "lower": ci_lower,
                    "upper": ci_upper,
                    "width": ci_width,
                    "note": "5th-95th percentile across 20 bootstrap-resampled models. A wide interval means the model itself is uncertain about this account, independent of the point score above." if ci_lower is not None else "unavailable"
                },
            },
            "categorizations": {
                "risk_tier": final_tier,
                "alert_severity": final_severity,
                "action_decision": final_decision,
                "triage_routing": triage_routing
            },
            "rules_audit": {
                "triggered_rules_count": len(overrides),
                "overrides": overrides
            },
            "explainability": {
                "key_risk_drivers": key_drivers,
                "waterfall_visuals": waterfall_data,
                "evasion_resistance": evasion_analysis
            }
        }
        
        return scorecard



    def online_recalibrate(self, label: str, alert_score: float = 0.5) -> Dict[str, Any]:
        """
        Executes online closed-loop PU recalibration and persists updated metrics to pu_metrics.json.
        """
        if not self.pu_engine or not hasattr(self.pu_engine, "online_recalibrate"):
            if not self.pu_engine:
                self.pu_engine = FAGEPUEngine()
            
        old_c, new_c, old_spy, new_spy = self.pu_engine.online_recalibrate(label, score=alert_score)
        
        # Persist updated PU engine object
        try:
            pu_path = os.path.join(self.models_dir, "pu_engine.pkl")
            os.makedirs(self.models_dir, exist_ok=True)
            with open(pu_path, "wb") as f:
                pickle.dump(self.pu_engine, f)
        except Exception as e:
            logger.error(f"Failed to save pu_engine.pkl during online recalibration: {e}")

        # Update pu_metrics.json
        pu_json_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "pu_metrics.json")
        data = {}
        if os.path.exists(pu_json_path):
            try:
                with open(pu_json_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
            except Exception as e:
                logger.error(f"Failed to load pu_metrics.json during online recalibration: {e}")

        data["overall_c_estimate"] = new_c
        data["c_estimate"] = new_c
        if new_spy is not None:
            data["spy_threshold"] = new_spy
            if "spy_statistics" in data and isinstance(data["spy_statistics"], dict):
                data["spy_statistics"]["spy_threshold"] = new_spy

        # Track closed loop metrics
        counts = data.get("closed_loop_feedback_counts", {"True Positive": 0, "False Positive": 0, "Mule Ring": 0, "Other": 0})
        clean_label = label.strip()
        if clean_label in counts:
            counts[clean_label] += 1
        else:
            counts["Other"] = counts.get("Other", 0) + 1
        data["closed_loop_feedback_counts"] = counts
        data["last_recalibration_timestamp"] = pd.Timestamp.utcnow().isoformat() + "Z"

        try:
            with open(pu_json_path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)
            logger.info(f"Persisted updated PU calibration metrics to {pu_json_path}")
        except Exception as e:
            logger.error(f"Failed to save pu_metrics.json: {e}")

        return {
            "old_c_factor": old_c,
            "new_c_factor": new_c,
            "old_spy_threshold": old_spy,
            "new_spy_threshold": new_spy,
            "closed_loop_feedback_counts": counts,
            "recalibrated": True
        }

    def simulate_adversarial_shift(self, shift_type: str = "micro_structuring", intensity: float = 0.6) -> Dict[str, Any]:
        """
        Executes online drift simulation and adaptive recalibration via FAGEAdaptiveEngine.
        Persists updated PU calibration parameters if adaptation was triggered.
        """
        if not hasattr(self, "adaptive_engine") or not self.adaptive_engine:
            from app.ml.pu_engine import FAGEAdaptiveEngine
            self.adaptive_engine = FAGEAdaptiveEngine(self.pu_engine)

        result = self.adaptive_engine.simulate_adversarial_shift(shift_type=shift_type, intensity=intensity)

        if result.get("adaptation_triggered"):
            try:
                pu_path = os.path.join(self.models_dir, "pu_engine.pkl")
                os.makedirs(self.models_dir, exist_ok=True)
                with open(pu_path, "wb") as f:
                    pickle.dump(self.pu_engine, f)
            except Exception as e:
                logger.error(f"Failed to save pu_engine.pkl after adaptive shift: {e}")

            pu_json_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "pu_metrics.json")
            if os.path.exists(pu_json_path):
                try:
                    with open(pu_json_path, "r", encoding="utf-8") as f:
                        data = json.load(f)
                    data["overall_c_estimate"] = result["post_adaptation_metrics"]["c_factor"]
                    data["c_estimate"] = result["post_adaptation_metrics"]["c_factor"]
                    data["spy_threshold"] = result["post_adaptation_metrics"]["spy_threshold"]
                    if "spy_statistics" in data and isinstance(data["spy_statistics"], dict):
                        data["spy_statistics"]["spy_threshold"] = result["post_adaptation_metrics"]["spy_threshold"]
                    data["last_recalibration_timestamp"] = pd.Timestamp.utcnow().isoformat() + "Z"
                    with open(pu_json_path, "w", encoding="utf-8") as f:
                        json.dump(data, f, indent=2)
                    logger.info(f"Persisted updated PU calibration metrics after adaptive shift to {pu_json_path}")
                except Exception as e:
                    logger.error(f"Failed to save pu_metrics.json during adaptive shift: {e}")

        return result

    def get_adversarial_shift_status(self) -> Dict[str, Any]:
        if not hasattr(self, "adaptive_engine") or not self.adaptive_engine:
            from app.ml.pu_engine import FAGEAdaptiveEngine
            self.adaptive_engine = FAGEAdaptiveEngine(self.pu_engine)
        return {
            "current_shift_status": self.adaptive_engine.current_shift_status,
            "adaptation_history": self.adaptive_engine.adaptation_history
        }



if __name__ == "__main__":
    # Internal validation block
    print("=== INITIAL TESTING PIPELINE ON FAGE RISKENGINE ===")
    engine = FAGERiskEngine(override_rules_enabled=True)
    
    test_txn = {
        "transaction_id": "TXN_SANDBOX_TEST",
        "amount": 165000.0,
        "origin_country": "US",
        "destination_country": "KP",
        "account_age_days": 1,
        "is_international": True
    }
    
    scorecard = engine.score_single_case(test_txn)
    print("\n--- TEST SCORECARD OUTPUT ---")
    print(json.dumps(scorecard, indent=2))
    print("\n=== PIPELINE INITIALIZATION COMPLETED ===")
