/**
 * The timeline scrubber — the controls for time travel.
 *
 * Dragging the handle re-folds the recorded history to that instant (pausing the
 * engine); the LIVE button snaps back to the present and resumes.
 */
import type { SimController } from "../topology/useSimulation.js";

export function Timeline({ sim }: { sim: SimController }): JSX.Element {
  const duration = Math.max(sim.duration, 1);
  const value = sim.live ? duration : (sim.reviewTime ?? 0);

  return (
    <div className="timeline">
      <span className="timeline__clock">{Math.round(value).toLocaleString()}ms</span>
      <input
        className="timeline__range"
        type="range"
        min={0}
        max={duration}
        step={Math.max(1, Math.round(duration / 1000))}
        value={value}
        onChange={(e: { target: { value: string } }) => sim.scrubTo(Number(e.target.value))}
      />
      <span className="timeline__total">{Math.round(duration).toLocaleString()}ms</span>
      <button
        className={`btn timeline__live ${sim.live ? "is-live" : ""}`}
        onClick={sim.live ? sim.pause : sim.play}
        title={sim.live ? "Showing live state" : "Return to live"}
      >
        {sim.live ? "● LIVE" : "↦ Go live"}
      </button>
    </div>
  );
}
