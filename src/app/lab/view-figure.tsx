import type { ViewId } from "@/lib/lab/guide";
import type { GpuResult } from "@/lib/lab/results";
import { Accumulation, Dispatch, Invocation, Memory } from "./figures-gpu";
import { FrameMap, Objects, Timeline } from "./figures-host";
import { DivergenceExplorer } from "./divergence-explorer";
import { SyncWalkthrough } from "./sync-walkthrough";
import { Bounce, Camera, Intersection, RandomNumbers } from "./figures-maths";
import { MemoryBinding, ShaderBuild, Swapchain, Timing } from "./figures-vulkan";

// The figure for each Lab view.

export function ViewFigure({ id, results }: { id: ViewId; results?: Record<"iris" | "rx", GpuResult> }) {
  switch (id) {
    case "frame":
      return <FrameMap />;
    case "objects":
      return <Objects />;
    case "timeline":
      return <Timeline />;
    case "sync":
      return <SyncWalkthrough />;
    case "dispatch":
      return <Dispatch />;
    case "invocation":
      return <Invocation />;
    case "divergence":
      return <DivergenceExplorer />;
    case "memory":
      return <Memory results={results} />;
    case "accumulation":
      return <Accumulation />;
    case "shader-build":
      return <ShaderBuild />;
    case "memory-binding":
      return <MemoryBinding />;
    case "swapchain":
      return <Swapchain />;
    case "timing":
      return <Timing />;
    case "camera":
      return <Camera />;
    case "intersection":
      return <Intersection />;
    case "bounce":
      return <Bounce />;
    case "random":
      return <RandomNumbers />;
  }
}

