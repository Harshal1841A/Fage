import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Network } from 'vis-network';
import { DataSet } from 'vis-data';
import { fageApi, CorrelateResponse } from '../services/api';
import { SystemTheme } from '../types';

interface NetworkGraphProps {
  alertId: string;
  theme?: SystemTheme;
  isGlobal?: boolean;
}

export const NetworkGraph: React.FC<NetworkGraphProps> = ({ alertId, theme }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const networkRef = useRef<Network | null>(null);
  // Keep stable DataSet references so vis-network updates nodes in-place (no position scramble)
  const nodesDataRef = useRef<InstanceType<typeof DataSet> | null>(null);
  const edgesDataRef = useRef<InstanceType<typeof DataSet> | null>(null);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<CorrelateResponse | null>(null);
  const [physicsEnabled, setPhysicsEnabled] = useState(true);

  const isDark = theme !== 'sovereign';

  // Fetch only when alertId changes — never on theme change
  useEffect(() => {
    const fetchCorrelation = async () => {
      setLoading(true);
      try {
        const res = await fageApi.correlateAlert(alertId);
        setData(res);
      } catch (err) {
        console.error("Correlation error", err);
      } finally {
        setLoading(false);
      }
    };
    if (alertId) {
      fetchCorrelation();
    }
  }, [alertId]);

  // Build graph only when DATA changes (not theme). Theme changes call updateNodeColors() below.
  useEffect(() => {
    if (containerRef.current && data) {
      const nodesMap = new Map<string, any>();
      const edges: any[] = [];

      const labelColor = isDark ? '#ffffff' : '#0f1c22';
      const edgeColor = isDark ? '#4cd7f6' : '#006880';
      const edgeColorDim = isDark ? '#64748b' : '#6f8a97';

      // 1. Central Target Alert Node
      nodesMap.set(data.target_alert, {
        id: data.target_alert,
        label: `Target Alert:\n${data.target_alert}`,
        color: { background: '#ef4444', border: '#b91c1c' },
        font: { color: '#ffffff', face: 'monospace', size: 13, bold: true },
        shape: 'box',
        shadow: true,
        title: `Target Alert ID: ${data.target_alert} | Focus of Investigation`
      });

      const addedBridges = new Set<string>();

      // 2. Map Related Entities & Bridges
      if (data.related_entities && data.related_entities.length > 0) {
        data.related_entities.forEach((entity) => {
          const amtText = entity.amount ? `\n₹${entity.amount.toLocaleString('en-IN')}` : '';
          const hopText = entity.hop_distance === 2 ? ' [2-Hop]' : ' [1-Hop]';
          
          nodesMap.set(entity.alert_id, {
            id: entity.alert_id,
            label: `${entity.alert_id}${hopText}\nTier: ${entity.risk_tier}${amtText}`,
            color: {
              background: entity.risk_tier === 'Critical' ? '#f97316' : entity.risk_tier === 'High' ? '#eab308' : '#3b82f6',
              border: isDark ? '#334155' : '#cbd5e1'
            },
            font: { color: '#ffffff', face: 'monospace', size: 11 },
            shape: 'ellipse',
            shadow: true,
            title: `Alert: ${entity.alert_id} | Tier: ${entity.risk_tier} | Match: ${(entity.match_reasons || []).join('; ')}`
          });

          if (entity.hop_distance === 2 && entity.bridge_entity) {
            if (!addedBridges.has(entity.bridge_entity)) {
              addedBridges.add(entity.bridge_entity);
              nodesMap.set(entity.bridge_entity, {
                id: entity.bridge_entity,
                label: `Bridge:\n${entity.bridge_entity}`,
                color: { background: '#a855f7', border: '#7e22ce' },
                font: { color: '#ffffff', face: 'monospace', size: 11, bold: true },
                shape: 'diamond',
                shadow: true,
                title: `Intermediary Mule/Bridge Account: ${entity.bridge_entity}`
              });
              edges.push({
                from: data.target_alert,
                to: entity.bridge_entity,
                label: 'Hop 1: Shared Intermediary / Ring',
                font: { color: isDark ? '#c084fc' : '#7e22ce', size: 10, align: 'middle' },
                color: { color: isDark ? '#a855f7' : '#7e22ce', opacity: 0.9 },
                dashes: false,
                width: 2,
                arrows: { to: { enabled: true, scaleFactor: 0.6 } }
              });
            }
            edges.push({
              from: entity.bridge_entity,
              to: entity.alert_id,
              label: `Hop 2: ${(entity.match_reasons && entity.match_reasons[0])?.slice(0, 35) || 'Chain'}...`,
              font: { color: labelColor, size: 10, align: 'middle' },
              color: { color: edgeColorDim, opacity: 0.8 },
              dashes: true,
              arrows: { to: { enabled: true, scaleFactor: 0.5 } }
            });
          } else {
            edges.push({
              from: data.target_alert,
              to: entity.alert_id,
              label: (entity.match_reasons || []).join(', ').slice(0, 40),
              font: { color: labelColor, size: 10, align: 'middle' },
              color: { color: edgeColor, opacity: 0.85 },
              dashes: true,
              width: 1.5,
              arrows: { to: { enabled: true, scaleFactor: 0.5 } }
            });
          }
        });
      } else {
        // Fallback: If no direct multi-hop links exist, render structural origin/destination ring nodes so graph is informative
        const originNode = `${data.target_alert}-SENDER`;
        const destNode = `${data.target_alert}-RECEIVER`;
        nodesMap.set(originNode, {
          id: originNode,
          label: `Origin Account:\nSender Profile`,
          color: { background: isDark ? '#06b6d4' : '#006880', border: isDark ? '#00424f' : '#003640' },
          font: { color: '#ffffff', face: 'monospace', size: 11, bold: true },
          shape: 'ellipse',
          shadow: true
        });
        nodesMap.set(destNode, {
          id: destNode,
          label: `Destination Account:\nBeneficiary Profile`,
          color: { background: isDark ? '#e89337' : '#8c4a00', border: isDark ? '#5b3200' : '#2d1600' },
          font: { color: '#ffffff', face: 'monospace', size: 11, bold: true },
          shape: 'ellipse',
          shadow: true
        });
        edges.push({
          from: originNode,
          to: data.target_alert,
          label: 'Tx Origin Inflow',
          font: { color: labelColor, size: 10, align: 'middle' },
          color: { color: edgeColor, opacity: 0.8 },
          arrows: { to: { enabled: true, scaleFactor: 0.6 } }
        });
        edges.push({
          from: data.target_alert,
          to: destNode,
          label: 'Tx Outflow Destination',
          font: { color: labelColor, size: 10, align: 'middle' },
          color: { color: edgeColor, opacity: 0.8 },
          arrows: { to: { enabled: true, scaleFactor: 0.6 } }
        });
      }

      const nodesArray = Array.from(nodesMap.values());

      if (networkRef.current && nodesDataRef.current && edgesDataRef.current) {
        // Graph already exists for this alert — just update the datasets in-place (preserves positions)
        nodesDataRef.current.clear();
        nodesDataRef.current.add(nodesArray);
        edgesDataRef.current.clear();
        edgesDataRef.current.add(edges);
      } else {
        // First render for this alert — create fresh Network
        const ds_nodes = new DataSet(nodesArray);
        const ds_edges = new DataSet(edges);
        nodesDataRef.current = ds_nodes;
        edgesDataRef.current = ds_edges;

        const options: any = {
          physics: {
            enabled: physicsEnabled,
            stabilization: true,
            barnesHut: { gravitationalConstant: -3000, springConstant: 0.045, springLength: 150 }
          },
          interaction: { hover: true, zoomView: true, dragNodes: true },
          edges: { smooth: { enabled: true, type: 'continuous', roundness: 0.35 } }
        };

        const network = new Network(containerRef.current!, { nodes: ds_nodes, edges: ds_edges }, options);
        networkRef.current = network;
      }

      return () => {
        if (networkRef.current) {
          networkRef.current.destroy();
          networkRef.current = null;
          nodesDataRef.current = null;
          edgesDataRef.current = null;
        }
      };
    }
  // isDark intentionally excluded — theme changes are handled by updateNodeColors() to avoid position scramble
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // When theme changes, update node/edge colors IN-PLACE without rebuilding (no position scramble)
  useEffect(() => {
    if (!networkRef.current || !nodesDataRef.current || !edgesDataRef.current || !data) return;

    const labelColor = isDark ? '#ffffff' : '#0f1c22';
    const edgeColor = isDark ? '#4cd7f6' : '#006880';

    // Update target alert node color
    nodesDataRef.current.update({
      id: data.target_alert,
      color: { background: '#ef4444', border: '#b91c1c' },
    });

    // Update all entity nodes border colors
    if (data.related_entities) {
      data.related_entities.forEach((entity) => {
        nodesDataRef.current!.update({
          id: entity.alert_id,
          color: {
            background: entity.risk_tier === 'Critical' ? '#f97316' : entity.risk_tier === 'High' ? '#eab308' : '#3b82f6',
            border: isDark ? '#334155' : '#cbd5e1'
          }
        });
      });
    }

    // Update edge colors
    const allEdges = edgesDataRef.current.get();
    edgesDataRef.current.update(
      allEdges.map((e: any) => ({
        id: e.id,
        font: { ...e.font, color: labelColor },
        color: { ...e.color, color: edgeColor }
      }))
    );
  }, [isDark]);

  const handleZoomIn = () => {
    if (networkRef.current) {
      const scale = networkRef.current.getScale();
      networkRef.current.moveTo({ scale: scale * 1.3 });
    }
  };

  const handleZoomOut = () => {
    if (networkRef.current) {
      const scale = networkRef.current.getScale();
      networkRef.current.moveTo({ scale: scale / 1.3 });
    }
  };

  const handleFit = () => {
    if (networkRef.current) {
      networkRef.current.fit({ animation: { duration: 400, easingFunction: 'easeInOutQuad' } });
    }
  };

  const togglePhysics = () => {
    const next = !physicsEnabled;
    setPhysicsEnabled(next);
    // BUG-001 FIX: Use native vis-network setOptions instead of triggering full graph rebuild
    if (networkRef.current) {
      networkRef.current.setOptions({ physics: { enabled: next } });
    }
  };

  if (loading) {
    return (
      <div className="stitch-glass-card border border-outline-variant rounded-xl p-6 w-full flex flex-col items-center justify-center min-h-[320px] text-on-surface-variant text-sm animate-pulse">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mb-3"></div>
        Running multi-hop graph correlation, ring detection & structuring analysis...
      </div>
    );
  }

  if (!data) return null;

  const summary = data.graph_summary;

  return (
    <div className={`border rounded-xl p-4 w-full flex flex-col gap-3 shadow-sm transition-all ${
      isDark ? 'bg-surface-container-low border-outline-variant text-slate-200' : 'bg-white border-[#c4c5d5] text-slate-800'
    }`}>
      <div className="flex flex-col gap-3 border-b border-outline-variant/30 pb-3">
        {/* Title Row */}
        <div className="flex items-center gap-2 w-full min-w-0">
          <svg className="w-4 h-4 text-primary shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
          </svg>
          <h3 className="text-sm font-bold uppercase tracking-wider truncate break-words">
            Transaction-Level Multi-Hop Correlation Graph
          </h3>
        </div>

        {/* Interactive Controls & Badges Row */}
        <div className="flex flex-wrap items-center justify-between gap-2 w-full">
          {summary && (
            <div className="flex items-center gap-1.5 text-[11px] font-mono font-bold mr-2">
              <span className={`px-2 py-0.5 rounded border ${isDark ? 'bg-slate-800 text-cyan-300 border-cyan-500/30' : 'bg-cyan-50 text-cyan-800 border-cyan-200'}`}>
                Cluster: {summary.cluster_size}
              </span>
              <span className={`px-2 py-0.5 rounded border ${isDark ? 'bg-slate-800 text-purple-300 border-purple-500/30' : 'bg-purple-50 text-purple-800 border-purple-200'}`}>
                Max Hop: {summary.max_hop_distance}
              </span>
              {(summary.bridge_nodes?.length ?? 0) > 0 && (
                <span className={`px-2 py-0.5 rounded border ${isDark ? 'bg-slate-800 text-amber-300 border-amber-500/30' : 'bg-amber-50 text-amber-800 border-amber-200'}`}>
                  Bridges: {summary.bridge_nodes?.length ?? 0}
                </span>
              )}
            </div>
          )}

          <div className="flex items-center gap-1 bg-surface-container p-1 rounded-md border border-outline-variant/40">
            <button onClick={handleZoomIn} title="Zoom In" className="px-2 py-0.5 text-xs hover:bg-primary/20 rounded font-bold transition-colors">➕</button>
            <button onClick={handleZoomOut} title="Zoom Out" className="px-2 py-0.5 text-xs hover:bg-primary/20 rounded font-bold transition-colors">➖</button>
            <button onClick={handleFit} title="Fit to View" className="px-2 py-0.5 text-[11px] font-mono font-bold hover:bg-primary/20 rounded transition-colors">FIT</button>
            <button 
              onClick={togglePhysics} 
              title={physicsEnabled ? "Freeze Layout Physics" : "Enable Physics"} 
              className={`px-2 py-0.5 text-[10px] uppercase font-bold rounded transition-colors ${physicsEnabled ? 'bg-primary text-on-primary' : 'bg-surface-container-highest text-on-surface-variant'}`}
            >
              {physicsEnabled ? "Physics ON" : "Physics OFF"}
            </button>
          </div>
        </div>
      </div>

      {summary?.structuring_detected && (
        <div className={`p-2.5 rounded-lg border text-xs flex items-center gap-2 font-sans font-semibold ${
          isDark ? 'bg-red-950/40 border-red-500/40 text-red-300' : 'bg-red-50 border-red-300 text-red-800'
        }`}>
          <span className="px-1.5 py-0.5 rounded bg-red-600 text-white font-black text-[10px] uppercase font-mono">
            Structuring Alert
          </span>
          <span>
            Multi-hop ring or velocity smurfing detected across {summary.cluster_size} accounts via intermediary bridge(s) [{(summary.bridge_nodes ?? []).join(', ')}].
          </span>
        </div>
      )}

      <div 
        ref={containerRef} 
        className={`w-full h-[360px] rounded border transition-colors ${
          isDark ? 'bg-[#0a0f11] border-outline-variant/40' : 'bg-[#f8fafc] border-[#cbd5e1]'
        }`} 
      />
    </div>
  );
};
