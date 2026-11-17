/**
 * Scene content budgets (visual only; physics keeps its 120 Hz step). The
 * drawing-buffer size, sun shadows and post effects follow the quality
 * presets in src/render/render-config.ts.
 */
export const renderBudget = {
  /** Studio (editor) shadow map; the field uses cascaded shadows. */
  shadowSize: 1024,
  terrainSegments: 128,
  grassTufts: 2400,
  dryGrassTufts: 600,
  grassBlades: 3,
  idleFramesPerSecond: 30,
} as const;
