
export const SLOT_W = 236;
export const SLOT_H = 280;
export const TILE_W = 196;
export const TILE_H = 236;
export const WALL_YAW = 28;
export const WALL_PITCH = 0;
export const PERSPECTIVE_PX = 1800;
/**
 * Each card's own 3D pose on the wall. Must match `.tile-card { transform }`
 * in globals.css (rotateY / translateZ) so the card the agent carries can be
 * projected onto exactly the pixels the wall will draw.
 */
export const TILE_TILT_DEG = -8;
export const TILE_LIFT_PX = 24;
export const OCCUPANCY_CHAR_CAP = 1500;
export const PLACE_BATCH_MAX = 8;
export const CLUSTER_MOVE_MAX = 8;
export const CLIP_CHARS = 500;
export const BODY_CHARS = 250000;
