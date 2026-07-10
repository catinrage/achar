export const MACHINE_PLANE = {
  XY: 17,
  YZ: 18,
  ZX: 19,
} as const;

export const MOTION_MODE = {
  RAPID: 0,
  LINE: 1,
  ARC: 2,
  ARC_2: 3,
} as const;

export const UNIT_SYSTEM = {
  MM: 700,
  INCH: 710,
} as const;

export const POSITIONING_MODE = {
  ABSOLUTE: 90,
  RELATIVE: 91,
} as const;

export const FEED_RATE_MODE = {
  MM_MIN: 94,
  CSS: 95,
} as const;

export const SPINDLE_DIRECTION = {
  CW: 3,
  CCW: 4,
} as const;
