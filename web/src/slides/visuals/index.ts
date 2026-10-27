import type { ComponentType } from "react";
import type { VisualKey } from "@ava/shared";
import { AdverseEvents } from "./AdverseEvents.js";
import { GutHormone } from "./GutHormone.js";
import { Receptor } from "./Receptor.js";
import { Timeline } from "./Timeline.js";
import { Trials } from "./Trials.js";
import { Uses } from "./Uses.js";

/** Every number in a visual comes from a reviewed deck fact (named in each component). */
export const VISUALS: Record<VisualKey, ComponentType> = {
  "gut-hormone": GutHormone,
  receptor: Receptor,
  uses: Uses,
  trials: Trials,
  "adverse-events": AdverseEvents,
  timeline: Timeline,
};
