export const CANVAS_W = 480;
export const CANVAS_H = 160;
export const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

// Waveform drawing parameters
export const WAVEFORM_CENTER_RATIO = 0.45;    // vertical center position (shifted up for reflection)
export const WAVEFORM_MAX_BAR_RATIO = 0.85;   // max bar height as fraction of center space
export const WAVEFORM_REFLECTION_ALPHA = 0.35; // opacity of mirrored reflection bars
