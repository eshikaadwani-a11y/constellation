/**
 * Throughput metrics, rendered with ECharts.
 *
 * The series are computed from the recorded event history (optionally truncated
 * to the current time-travel position), so the chart reflects exactly what the
 * canvas shows.
 */
import { useEffect, useRef } from "react";
import { init, type EChartsInstance } from "echarts";
import { computeMetrics, type EventRecorder } from "@constellation/engine";

interface Props {
  recorder: EventRecorder;
  version: number;
  viewTime: number;
}

export function MetricsChart({ recorder, version, viewTime }: Props): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<EChartsInstance | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = init(ref.current, null, { renderer: "canvas" });
    chartRef.current = chart;
    const onResize = (): void => chart.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const events = Number.isFinite(viewTime) ? recorder.until(viewTime) : recorder.all();
    const span = recorder.duration || 1000;
    const bucketMs = Math.max(50, Math.round(span / 120));
    const metrics = computeMetrics(events, bucketMs);
    const axis = metrics.buckets.map((b) => b.t);

    chart.setOption(
      {
        backgroundColor: "transparent",
        textStyle: { color: "#aab2c5", fontFamily: "Inter, sans-serif", fontSize: 11 },
        grid: { top: 28, right: 16, bottom: 24, left: 44 },
        legend: {
          top: 0,
          right: 0,
          textStyle: { color: "#aab2c5" },
          data: ["sent", "delivered", "dropped"],
        },
        tooltip: { trigger: "axis" },
        xAxis: {
          type: "category",
          data: axis,
          axisLine: { lineStyle: { color: "#272d40" } },
          axisLabel: { formatter: (v: string) => `${Math.round(Number(v) / 1000)}s` },
        },
        yAxis: {
          type: "value",
          splitLine: { lineStyle: { color: "#1c2130" } },
        },
        series: [
          series(
            "sent",
            metrics.buckets.map((b) => b.sent),
            "#5b8cff",
          ),
          series(
            "delivered",
            metrics.buckets.map((b) => b.delivered),
            "#3ad29f",
          ),
          series(
            "dropped",
            metrics.buckets.map((b) => b.dropped),
            "#ff5c7c",
          ),
        ],
      },
      true,
    );
  }, [recorder, version, viewTime]);

  return <div className="obs__chart" ref={ref} />;
}

function series(name: string, data: number[], color: string): Record<string, unknown> {
  return {
    name,
    type: "line",
    smooth: true,
    showSymbol: false,
    lineStyle: { width: 2, color },
    itemStyle: { color },
    areaStyle: { color, opacity: 0.08 },
    data,
  };
}
