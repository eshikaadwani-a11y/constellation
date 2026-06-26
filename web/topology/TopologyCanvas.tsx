/**
 * The interactive topology canvas.
 *
 * Renders the {@link TopologySnapshot} through React Flow: cluster members as
 * custom nodes, directed links as edges that animate while a message is in
 * flight along them. Layout is deterministic (a circle), node positions survive
 * dragging, and only data — not geometry — is reconciled on each frame.
 */
import { useEffect, useMemo, useRef } from "react";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
} from "reactflow";
import { circularLayout, type TopologySnapshot } from "@constellation/engine";
import { ProtocolNode, type ProtocolNodeData } from "./ProtocolNode.js";

const ACTIVE_WINDOW = 250; // virtual ms since last activity that counts as "active"

interface Props {
  snapshot: TopologySnapshot;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

function nodeData(sn: TopologySnapshot["nodes"][number], now: number): ProtocolNodeData {
  return {
    label: sn.id,
    protocol: sn.protocol,
    status: sn.status,
    active: sn.status === "up" && now - sn.lastActiveAt <= ACTIVE_WINDOW,
  };
}

export function TopologyCanvas({ snapshot, selectedId, onSelect }: Props): JSX.Element {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const layoutRef = useRef<Map<string, { x: number; y: number }>>(new Map());

  const nodeTypes = useMemo(() => ({ protocol: ProtocolNode }), []);

  useEffect(() => {
    const ids = snapshot.nodes.map((n) => n.id);

    // Recompute the circular layout only when the node set changes; otherwise
    // keep positions so user dragging persists.
    const layout = layoutRef.current;
    const setChanged = ids.length !== layout.size || ids.some((id) => !layout.has(id));
    if (setChanged) {
      const radius = 180 + ids.length * 10;
      layoutRef.current = circularLayout(ids, { radius });
    }

    setNodes((prev) => {
      const prevById = new Map(prev.map((n) => [n.id, n]));
      return snapshot.nodes.map((sn): Node<ProtocolNodeData> => {
        const existing = prevById.get(sn.id);
        const position = existing?.position ?? layoutRef.current.get(sn.id) ?? { x: 0, y: 0 };
        return {
          id: sn.id,
          type: "protocol",
          position,
          data: nodeData(sn, snapshot.time),
          selected: sn.id === selectedId,
        };
      });
    });

    const inFlightLinks = new Set(snapshot.inFlight.map((m) => `${m.from}->${m.to}`));
    setEdges(
      snapshot.links.map((link): Edge => {
        const active = inFlightLinks.has(link.id);
        return {
          id: link.id,
          source: link.source,
          target: link.target,
          animated: active,
          style: {
            stroke: active ? "var(--primary)" : "var(--border-strong)",
            strokeWidth: active ? 2 : 1,
            opacity: active ? 1 : 0.5,
          },
        };
      }),
    );
  }, [snapshot, selectedId, setNodes, setEdges]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={nodeTypes}
      onNodeClick={(_e: unknown, node: Node) => onSelect(node.id)}
      onPaneClick={() => onSelect(null)}
      fitView
      minZoom={0.2}
      maxZoom={2}
      proOptions={{ hideAttribution: true }}
    >
      <Background color="var(--border-subtle)" gap={24} />
      <MiniMap
        pannable
        zoomable
        nodeColor="var(--bg-raised)"
        maskColor="rgba(5,6,10,0.7)"
        style={{ background: "var(--bg-surface)" }}
      />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}
