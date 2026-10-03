// docs/23 §5: the Play and Vote blocks keep the pixel face for a short label ("Play", "Vote", "Starting…"); a long one
// ("Vote first, it takes ten seconds") is Segoe UI semibold 15, as the app does (AppUi.BlockFaceMaxChars, 14).
export const BLOCK_FACE_MAX = 14;
export const shortLabel = (label: string) => label.length <= BLOCK_FACE_MAX;
