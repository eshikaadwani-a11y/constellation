/**
 * The bridge between the deterministic engine and React.
 *
 * `useSimulation` owns a {@link Simulation} and a {@link TopologyModel}, drives
 * the clock from a requestAnimationFrame loop scaled by a playback speed, and
 * surfaces an immutable {@link TopologySnapshot} plus transport-style controls
 * (play / pause / step / reset). The engine stays pure; this hook is the only
 * place wall-clock time touches it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Simulation } from "@constellation/engine";
import { TopologyModel, type TopologySnapshot } from "@constellation/engine";
import { scenarioById } from "../scenarios.js";

export interface SimStats {
  events: number;
  inFlight: number;
  delivered: number;
  dropped: number;
}

export interface SimController {
  snapshot: TopologySnapshot;
  time: number;
  playing: boolean;
  speed: number;
  stats: SimStats;
  scenarioId: string;
  nodeCount: number;
  seed: number;
  play(): void;
  pause(): void;
  toggle(): void;
  step(): void;
  reset(): void;
  setSpeed(speed: number): void;
  load(scenarioId: string, nodeCount: number, seed: number): void;
  crash(id: string): void;
  restart(id: string): void;
  stateOf(id: string): unknown;
}

interface Engine {
  sim: Simulation;
  model: TopologyModel;
  unsubscribe: () => void;
}

function createEngine(scenarioId: string, nodeCount: number, seed: number): Engine {
  const sim = new Simulation({ seed });
  const model = new TopologyModel();
  const unsubscribe = model.attach(sim); // attach BEFORE nodes are added
  scenarioById(scenarioId).populate(sim, nodeCount);
  return { sim, model, unsubscribe };
}

export function useSimulation(initialScenario = "ring"): SimController {
  const initial = scenarioById(initialScenario);
  const [config, setConfig] = useState({
    scenarioId: initialScenario,
    nodeCount: initial.defaultNodes,
    seed: 42,
  });
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [snapshot, setSnapshot] = useState<TopologySnapshot>(() => ({
    time: 0,
    nodes: [],
    links: [],
    inFlight: [],
    delivered: 0,
    dropped: 0,
  }));

  const engineRef = useRef<Engine | null>(null);
  const playingRef = useRef(playing);
  const speedRef = useRef(speed);
  playingRef.current = playing;
  speedRef.current = speed;

  // (Re)build the engine whenever the scenario configuration changes.
  useEffect(() => {
    engineRef.current?.unsubscribe();
    const engine = createEngine(config.scenarioId, config.nodeCount, config.seed);
    engineRef.current = engine;
    setSnapshot(engine.model.snapshot());
    setPlaying(true);
    return () => engine.unsubscribe();
  }, [config]);

  // The animation-frame driver.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (now: number): void => {
      const engine = engineRef.current;
      if (engine && playingRef.current) {
        const dt = Math.min(now - last, 100); // clamp tab-switch jumps
        const virtual = dt * speedRef.current;
        if (virtual > 0) {
          engine.sim.run({ until: engine.sim.now + virtual, maxSteps: 20000 });
          setSnapshot(engine.model.snapshot());
        }
      }
      last = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const step = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    setPlaying(false);
    engine.sim.step();
    setSnapshot(engine.model.snapshot());
  }, []);

  const reset = useCallback(() => {
    setConfig((c) => ({ ...c })); // new object → triggers rebuild effect
  }, []);

  const load = useCallback((scenarioId: string, nodeCount: number, seed: number) => {
    setConfig({ scenarioId, nodeCount, seed });
  }, []);

  const crash = useCallback((id: string) => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.sim.crash(id);
    setSnapshot(engine.model.snapshot());
  }, []);

  const restart = useCallback((id: string) => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.sim.restart(id);
    setSnapshot(engine.model.snapshot());
  }, []);

  const stateOf = useCallback((id: string) => engineRef.current?.sim.stateOf(id), []);

  const stats: SimStats = useMemo(
    () => ({
      events: engineRef.current?.sim.eventCount ?? 0,
      inFlight: snapshot.inFlight.length,
      delivered: snapshot.delivered,
      dropped: snapshot.dropped,
    }),
    [snapshot],
  );

  return {
    snapshot,
    time: snapshot.time,
    playing,
    speed,
    stats,
    scenarioId: config.scenarioId,
    nodeCount: config.nodeCount,
    seed: config.seed,
    play: useCallback(() => setPlaying(true), []),
    pause: useCallback(() => setPlaying(false), []),
    toggle: useCallback(() => setPlaying((p) => !p), []),
    step,
    reset,
    setSpeed,
    load,
    crash,
    restart,
    stateOf,
  };
}
