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
  Random,
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
  // --- chaos ---
  loss: number;
  isolated: string[];
  monkey: boolean;
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
  setLoss(rate: number): void;
  toggleIsolate(id: string): void;
  reconnectAll(): void;
  toggleMonkey(): void;
}

interface Engine {
  sim: Simulation;
  model: TopologyModel;
  network: Network;
  recorder: EventRecorder;
  partitions: Map<string, number>;
  monkeyRng: Random;
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
    partitions: new Map<string, number>(),
    monkeyRng: new Random(0xc0ffee ^ seed),
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
  const [loss, setLossState] = useState(0);
  const [isolated, setIsolated] = useState<string[]>([]);
  const [monkey, setMonkey] = useState(false);

  const engineRef = useRef<Engine | null>(null);
  const playingRef = useRef(playing);
  const reviewRef = useRef(reviewTime);
  const speedRef = useRef(speed);
  const monkeyRef = useRef(monkey);
  const monkeyNextRef = useRef(0);
  playingRef.current = playing;
  reviewRef.current = reviewTime;
  speedRef.current = speed;
  monkeyRef.current = monkey;

  useEffect(() => {
    engineRef.current?.unsubscribe();
    const engine = createEngine(config.scenarioId, config.nodeCount, config.seed);
    engineRef.current = engine;
    setLiveSnapshot(engine.model.snapshot());
    setReviewTime(null);
    setVersion((v) => v + 1);
    setLossState(0);
    setIsolated([]);
    setMonkey(false);
    monkeyNextRef.current = 0;
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
          // Chaos monkey: fail a random live node on a cadence.
          if (monkeyRef.current) {
            if (monkeyNextRef.current === 0) monkeyNextRef.current = engine.sim.now + 3000;
            if (engine.sim.now >= monkeyNextRef.current) {
              const alive = engine.sim.nodeIds().filter((id) => !engine.sim.isCrashed(id));
              if (alive.length > 1) {
                const victim = engine.monkeyRng.pick(alive);
                engine.sim.crash(victim);
                engine.sim.scheduleAt(engine.sim.now + 2500, () => engine.sim.restart(victim));
              }
              monkeyNextRef.current = engine.sim.now + 3500;
            }
          }
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

  const setLoss = useCallback((rate: number) => {
    engineRef.current?.network.setLossRate(rate);
    setLossState(rate);
  }, []);

  const toggleIsolate = useCallback((id: string) => {
    const engine = engineRef.current;
    if (!engine) return;
    setIsolated((prev) => {
      const existing = engine.partitions.get(id);
      if (existing !== undefined) {
        engine.network.heal(existing);
        engine.partitions.delete(id);
        return prev.filter((x) => x !== id);
      }
      engine.partitions.set(id, engine.network.partition([id]));
      return [...prev, id];
    });
  }, []);

  const reconnectAll = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.network.healAll();
    engine.partitions.clear();
    setIsolated([]);
  }, []);

  const toggleMonkey = useCallback(() => {
    monkeyNextRef.current = 0;
    setMonkey((m) => !m);
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
    loss,
    isolated,
    monkey,
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
    setLoss,
    toggleIsolate,
    reconnectAll,
    toggleMonkey,
  };
}
