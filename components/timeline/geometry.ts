/**
 * Shared geometry so Recharts numeric lanes and the SVG event strip share one time axis.
 * The label column sits outside the plot; inside the plot the Recharts y-axis takes
 * PLOT_LEFT px and PLOT_RIGHT px is reserved on the right so the last tick is visible.
 */

export const LABEL_WIDTH = 140;
export const PLOT_LEFT = 48;
export const PLOT_RIGHT = 12;
export const LANE_HEIGHT = 110;

export interface TimeMarker {
  ms: number;
  label: string;
  kind: "deviation" | "onset" | "cursor";
}

export function xScale(domain: [number, number], plotWidth: number): (ms: number) => number {
  const span = Math.max(1, domain[1] - domain[0]);
  const inner = Math.max(1, plotWidth - PLOT_LEFT - PLOT_RIGHT);
  return (ms) => PLOT_LEFT + ((ms - domain[0]) / span) * inner;
}
