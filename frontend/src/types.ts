export type ViewMode =
  | 'dashboard'
  | 'investigation'
  | 'explorer'
  | 'insights'
  | 'performance'
  | 'governance'
  | 'alerts'
  | 'admin';

export type SystemTheme = 'analytics' | 'sovereign';

export type DataSourceType = 'live-all' | 'live-target' | 'live-dataset';

interface RiskDriver {
  feature: string;
  importance_attribution: number;
  direction: 'increases_risk' | 'reduces_risk';
  raw_value: number;
}

interface ConfidenceInterval {
  lower: number | null;
  upper: number | null;
  width: number | null;
  note: string;
}

interface EvasionResistance {
  evadable_within_search?: boolean;
  features_required_to_change?: number;
  changed_features?: Array<{ feature: string; original_value: number; typical_legitimate_value: number }>;
  features_tried?: number;
  resulting_probability?: number;
  interpretation: string;
}

export interface TriageDecision {
  account_id?: string;
  risk_score?: number;
  pu_probability?: number;
  ci_lower?: number;
  ci_upper?: number;
  ci_width?: number;
  evadable?: boolean;
  triage_action?: 'FAST_TRACK_FREEZE' | 'PRIORITY_MANUAL_REVIEW' | 'INDEPENDENT_SIGNAL_CHECK' | 'STANDARD_MONITORING';
  priority_tier?: string;
  rationale?: string;
}

export interface Alert {
  id: string;
  accountNumber: string;
  receiverAccountId: string;
  type: string;
  riskScore: number;
  confidence: string;
  confidenceVal: number;
  status: 'Open' | 'Escalated' | 'Closed' | 'Investigating';
  timestamp: string;
  dateOpened?: string;
  transactionAmount: number;
  prio: string;
  assignedTo?: string;
  reason?: string;
  triage_action?: 'FAST_TRACK_FREEZE' | 'PRIORITY_MANUAL_REVIEW' | 'INDEPENDENT_SIGNAL_CHECK' | 'STANDARD_MONITORING';
  priority_tier?: string;
  pu_probability?: number;
  logs?: Array<{ operator: string; action: string; timestamp: string }>;
  sar_report?: string;
  keyRiskDrivers: RiskDriver[];
  confidenceInterval: ConfidenceInterval | null;
  evasionResistance: EvasionResistance | null;
  triageDecision: TriageDecision | null;
  hasRealExplainability: boolean;
}

export interface SHAPDriver {
  featureId: string;
  name: string;
  type: 'Behavioral' | 'Network' | 'Profile' | 'Technical';
  shapValue: number; // impact value (SHAP)
  importanceScore: number;
  value: string;
}

export interface AnalystNote {
  id: string;
  author: string;
  timestamp: string;
  content: string;
  isSystem: boolean;
}
