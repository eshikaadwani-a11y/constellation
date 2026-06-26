/**
 * The bridge between the deterministic engine and React.
 *
 * `useSimulation` owns a {@link Simulation}, a {@link TopologyModel}, and an
 * {@link EventRecorder}. It drives the clock from a requestAnimationFrame loop
 * scaled by a playback speed, and surfaces an immutable {@link TopologySnapshot}
 * plus transport-style controls. It also implements **time travel**: scrubbing
 * to a past moment re-folds the recorded history into the topology at that
 * instant, with the engine paused — no re-simulation required.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  EventRecorder,
  Network,
  Simulation,
  TopologyModel,
  uniformLatency,
  type TopologySnapshot,
} from "@constellation/engine";
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
  duration: number;
  playing: boolean;
  /** True when showing live state; false when scrubbed into the past. */
  live: boolean;
  reviewTime: number | null;
  speed: number;
  stats: SimStats;
  scenarioId: string;
  nodeCount: number;
  seed: number;
  recorder: EventRecorder;
  /** Bumps whenever the recorded history grows; a memo dependency for panels. */
  version: number;
  play(): void;
  pause(): void;
  toggle(): void;
  step(): void;
  reset(): void;
  setSpeed(speed: number): void;
  load(scenarioId: string, nodeCount: number, seed: number): void;
  crash(id: string): void;
  restart(id: string): void;
  scrubTo(time: number): void;
  exitReview(): void;
  stateOf(id: string): unknown;
}

interface Engine {
  sim: Simulation;
  model: TopologyModel;
  network: Network;
  recorder: EventRecorder;
  unsubscribe: () => void;
}

const EMPTY: TopologySnapshot = {
  time: 0,
  nodes: [],
  links: [],
  inFlight: [],
  delivered: 0,
  dropped: 0,
};

function createEngine(scenarioId: string, nodeCount: number, seed: number): Engine {
  const network = new Network({ latency: uniformLatency(40, 140) });
  const sim = new Simulation({ seed, transport: network });
  const model = new TopologyModel();
  const recorder = new EventRecorder({ cap: 200000 });
  const unModel = model.attach(sim);
  const unRec = recorder.attach(sim);
  scenarioById(scenarioId).populate(sim, nodeCount);
  return {
    sim,
    model,
    network,
    recorder,
    unsubscribe: () => {
      unModel();
      unRec();
    },
  };
}

function snapshotAt(recorder: EventRecorder, time: number): TopologySnapshot {
  const model = new TopologyModel();
  for (const e of recorder.until(time)) model.apply(e);
  return model.snapshot();
}

export function useSimulation(initialScenario = "raft"): SimController {
  const initial = scenarioById(initialScenario);
  const [config, setConfig] = useState({
    scenarioId: initialScenario,
    nodeCount: initial.defaultNodes,
    seed: 42,
  });
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [liveSnapshot, setLiveSnapshot] = useState<TopologySnapshot>(EMPTY);
  const [reviewTime, setReviewTime] = useState<number | null>(null);
  const [version, setVersion] = useState(0);

  const engineRef = useRef<Engine | null>(null);
  const playingRef = useRef(playing);
  const reviewRef = useRef(reviewTime);
  const speedRef = useRef(speed);
  playingRef.current = playing;
  reviewRef.current = reviewTime;
  speedRef.current = speed;

  useEffect(() => {
    engineRef.current?.unsubscribe();
    const engine = createEngine(config.scenarioId, config.nodeCount, config.seed);
    engineRef.current = engine;
    setLiveSnapshot(engine.model.snapshot());
    setReviewTime(null);
    setVersion((v) => v + 1);
    setPlaying(true);
    return () => engine.unsubscribe();
  }, [config]);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (now: number): void => {
      const engine = engineRef.current;
      if (engine && playingRef.current && reviewRef.current === null) {
        const dt = Math.min(now - last, 100);
        const virtual = dt * speedRef.current;
        if (virtual > 0) {
          engine.sim.run({ until: engine.sim.now + virtual, maxSteps: 50000 });
          setLiveSnapshot(engine.model.snapshot());
          setVersion((v) => v + 1);
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
    setReviewTime(null);
    engine.sim.step();
    setLiveSnapshot(engine.model.snapshot());
    setVersion((v) => v + 1);
  }, []);

  const reset = useCallback(() => setConfig((c) => ({ ...c })), []);
  const load = useCallback(
    (scenarioId: string, nodeCount: number, seed: number) =>
      setConfig({ scenarioId, nodeCount, seed }),
    [],
  );

  const crash = useCallback((id: string) => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.sim.crash(id);
    setLiveSnapshot(engine.model.snapshot());
    setVersion((v) => v + 1);
  }, []);

  const restart = useCallback((id: string) => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.sim.restart(id);
    setLiveSnapshot(engine.model.snapshot());
    setVersion((v) => v + 1);
  }, []);

  const scrubTo = useCallback((time: number) => {
    setPlaying(false);
    setReviewTime(time);
  }, []);
  const exitReview = useCallback(() => setReviewTime(null), []);
  const play = useCallback(() => {
    setReviewTime(null);
    setPlaying(true);
  }, []);

  const recorder = engineRef.current?.recorder ?? new EventRecorder();
  const displaySnapshot = useMemo(
    () => (reviewTime === null ? liveSnapshot : snapshotAt(recorder, reviewTime)),
    [reviewTime, liveSnapshot, recorder, version],
  );

  const stats: SimStats = {
    events: engineRef.current?.sim.eventCount ?? 0,
    inFlight: displaySnapshot.inFlight.length,
    delivered: displaySnapshot.delivered,
    dropped: displaySnapshot.dropped,
  };

  return {
    snapshot: displaySnapshot,
    time: reviewTime ?? displaySnapshot.time,
    duration: recorder.duration,
    playing,
    live: reviewTime === null,
    reviewTime,
    speed,
    stats,
    scenarioId: config.scenarioId,
    nodeCount: config.nodeCount,
    seed: config.seed,
    recorder,
    version,
    play,
    pause: useCallback(() => setPlaying(false), []),
    toggle: useCallback(() => {
      setReviewTime(null);
      setPlaying((p) => !p);
    }, []),
    step,
    reset,
    setSpeed,
    load,
    crash,
    restart,
    scrubTo,
    exitReview,
    stateOf: useCallback((id: string) => engineRef.current?.sim.stateOf(id), []),
  };
}
