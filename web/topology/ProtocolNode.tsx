/**
 * A node on the topology canvas.
 *
 * Renders a cluster member as a labelled disc whose colour reflects its status
 * and whose ring pulses when it has recently sent or received a message. The
 * handles are present (so edges attach) but visually hidden — links route
 * node-centre to node-centre.
 */
import { Handle, Position, type NodeProps } from "reactflow";
import { motion } from "framer-motion";

export interface ProtocolNodeData {
  label: string;
  protocol: string;
  status: "up" | "down";
  active: boolean;
  /** Optional override colour (e.g. Raft role) supplied by a scenario. */
  accent?: string;
  /** Lightweight rendering for large clusters (skips per-node animation). */
  simple?: boolean;
}

const hiddenHandle = { opacity: 0, width: 1, height: 1, border: "none" } as const;

export function ProtocolNode({ data, selected }: NodeProps<ProtocolNodeData>): JSX.Element {
  const down = data.status === "down";
  const accent = down ? "var(--role-down)" : (data.accent ?? "var(--role-follower)");

  if (data.simple) {
    // Level-of-detail: a plain disc with no Framer Motion, so hundreds of nodes
    // stay smooth.
    return (
      <>
        <Handle type="target" position={Position.Top} style={hiddenHandle} isConnectable={false} />
        <div
          className="cnode cnode--simple"
          style={{
            borderColor: selected ? "var(--text-primary)" : accent,
            opacity: down ? 0.5 : 1,
            boxShadow: data.active ? `0 0 10px ${accent}` : "none",
          }}
        >
          <span className="cnode__id" style={{ color: accent }}>
            {data.label}
          </span>
        </div>
        <Handle
          type="source"
          position={Position.Bottom}
          style={hiddenHandle}
          isConnectable={false}
        />
      </>
    );
  }

  return (
    <>
      <Handle type="target" position={Position.Top} style={hiddenHandle} isConnectable={false} />
      <motion.div
        className="cnode"
        data-status={data.status}
        animate={{
          boxShadow: data.active
            ? `0 0 0 2px ${accent}, 0 0 22px ${accent}`
            : `0 0 0 1px ${accent}66`,
          scale: data.active ? 1.06 : 1,
        }}
        transition={{ duration: 0.25, ease: "easeOut" }}
        style={{
          borderColor: selected ? "var(--text-primary)" : "transparent",
          opacity: down ? 0.55 : 1,
        }}
      >
        <span className="cnode__id" style={{ color: accent }}>
          {data.label}
        </span>
        <span className="cnode__proto">{down ? "crashed" : data.protocol}</span>
      </motion.div>
      <Handle type="source" position={Position.Bottom} style={hiddenHandle} isConnectable={false} />
    </>
  );
}
