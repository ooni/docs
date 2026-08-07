/**
 * Events are graded in the *same* mechanism taxonomy as the measurement
 * labels, so this re-exports it rather than keeping a second copy that would
 * drift. Taxonomy v1 lives in ../labeler/mechanisms.ts.
 *
 * This is the only file in this directory that reaches outside it: if you
 * vendor `event-labeler/` into another app on its own, inline the taxonomy
 * here and nothing else changes.
 */
export {
  MECHANISM_TAXONOMY,
  MECHANISMS,
  MECH_BY_PATH,
  isInternalMechanism,
  filterMechanisms,
  addMechanism,
  type Mechanism,
} from "../labeler/mechanisms";
