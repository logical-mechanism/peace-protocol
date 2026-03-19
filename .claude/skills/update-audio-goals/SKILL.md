---
name: update-audio-goals
description: Regenerate app/gui/audio_goals.md with a fresh comprehensive analysis of the AudioPlayer component
---

# Update Audio Goals

Delete `audio_goals.md` and regenerate it from scratch with a comprehensive analysis of every possible improvement across the AudioPlayer component. Do not carry over completed items or skipped items from the previous round — this is a fresh audit against the current state of the code.

**Design intent:** The AudioPlayer is a Winamp-themed audio player integrated into the Veiled library modal. It uses a native `<audio>` element (routes through GStreamer via WebKitGTK) with a separate PCM decode via `OfflineAudioContext` for FFT visualization only. Custom Cooley-Tukey radix-2 FFT (1024 samples, 32 bars) and waveform overview (200 buckets, peak-detection downsampling). WebKitGTK's Web Audio API is broken (no AnalyserNode, no AudioWorklet). Styling uses Winamp-themed CSS variables defined in `fe/src/index.css`. Suggestions should feel native to a polished retro-inspired desktop media player — not a web-first SPA.

## Process

1. **Read CLAUDE.md** to understand the current architecture, conventions, and gotchas
2. **Read the current audio_goals.md** (if it exists) to understand what was previously identified — but do NOT preserve it. The output is a clean slate. Note any items marked `[s]` (skipped) — these were intentionally declined and must NOT be re-suggested in the new goals.
3. **Launch parallel Explore subagents** (all "very thorough") to audit the AudioPlayer:

   **Agent 1 — Playback, Transport & Visualization:**
   - Read the full `AudioPlayer.tsx` component line by line
   - Read the `VideoPlayer.tsx` component for feature parity comparison
   - Read `LibraryContentModal.tsx` for integration point (how data is passed, how the player is mounted)
   - Read `fe/src/config/categories.ts` for supported audio formats
   - Identify gaps using this checklist:
     - **Playback reliability**: Does the `<audio>` element handle all lifecycle events? Check for `stalled`, `waiting`, `suspend`, `abort`, `emptied`. Are there error states for unsupported formats? GStreamer codec gaps?
     - **FFT visualization**: Is the Cooley-Tukey implementation correct for all sample rates? Bar count/resolution appropriate? Segment rendering accurate? Peak hold behavior smooth? Are gradients and colors theme-aware?
     - **Waveform**: Is the 200-bucket downsampling accurate? Does the playhead track correctly during seeking? Does the waveform handle very short or very long files?
     - **Transport completeness**: Play, pause, stop, skip ±10s, speed, mute, volume, loop — anything missing vs VideoPlayer? Are keyboard shortcuts comprehensive and discoverable?
     - **Format handling**: mp3, wav, flac, ogg, aac, m4a, opus — all handled correctly? Are MIME types accurate for GStreamer? Are error messages helpful when a format fails?
     - **Edge cases**: What happens at audio end? Zero-length files? Corrupted files? Files with no audio track? Very large files and memory pressure?

   **Agent 2 — Performance & Memory:**
   - Read the PCM decode pipeline (OfflineAudioContext)
   - Read the FFT computation and canvas rendering loop
   - Read the waveform generation
   - Read `fe/src/index.css` for Winamp CSS variables, transitions, animations used by the player
   - Identify gaps using this checklist:
     - **PCM decode performance**: How large a file can be decoded before hitting memory limits? What's the memory cost for stereo float32 samples? Is the decode aborted on unmount?
     - **Canvas rendering**: RAF loop frequency? Is `requestAnimationFrame` cancelled on unmount? Are canvas dimensions handled for HiDPI? Is `getComputedStyle` called per frame (expensive)?
     - **Memory management**: Are Float32Array buffers released? Is OfflineAudioContext garbage collected? Is the audio element properly cleaned up on unmount (src cleared, event listeners removed)?
     - **Theme support**: Do all Winamp CSS variables have light-theme overrides? Do the FFT bars, waveform, LED display render correctly in light mode?

   **Agent 3 — UX, Accessibility & Testing:**
   - Read all UI rendering sections of `AudioPlayer.tsx` (the JSX return block)
   - Read the metadata parsing (music-metadata)
   - Read the LED display and time toggle logic
   - Read the test file at `fe/src/components/__tests__/AudioPlayer.test.tsx`
   - Identify gaps using this checklist:
     - **Accessibility**: Do transport buttons have proper ARIA labels? Is there `aria-live` for state changes (play/pause, volume, speed)? Are all interactive elements keyboard-reachable? Is tab order logical? Do sliders have `role="slider"` + ARIA attributes? Does the LED display button have accessible labeling?
     - **Loading states**: Is there a loading indicator during PCM decode? During metadata extraction? Is the user informed of what's happening?
     - **Error states**: Are error messages actionable? Are there silent failures?
     - **Metadata UX**: Is the scrolling title smooth? Does it handle very long or very short titles? Is bitrate/sample rate display accurate?
     - **Visual polish**: Winamp fidelity — does it look authentic? Are transitions smooth? Do buttons have proper hover/active/focus states? Is spacing consistent?
     - **Test coverage**: What utility functions are tested? What's NOT tested? Are edge cases covered (NaN, Infinity, empty arrays, zero-length audio)?

4. **Synthesize findings** from all agents into a single `audio_goals.md` file. Cross-reference between agents to eliminate duplicates. If an area has no genuine issues, do not pad it with filler items.

## Output Format

Write `audio_goals.md` with this structure:

```markdown
# AudioPlayer Goals & Improvements

A comprehensive backlog for making the AudioPlayer exceptional. Pick any item, implement it, check it off, and submit a PR.

**Architecture context:**
- Native `<audio>` element for playback (routes through GStreamer via WebKitGTK)
- Separate PCM decode via `OfflineAudioContext` for FFT visualization only
- Custom Cooley-Tukey radix-2 FFT (1024 samples, 32 bars)
- Waveform overview (200 buckets, peak-detection downsampling)
- WebKitGTK Web Audio API is broken (no AnalyserNode, no AudioWorklet)
- Styling uses Winamp-themed CSS variables defined in `fe/src/index.css`

Each item:
- `🔴` Critical — bugs, broken features
- `🟡` Important — UX improvements, user-requested features
- `🟢` Nice-to-have — polish, optimization

---

## N. Section Name

> Key files: `relevant/file/paths`

- [ ] 🟢 **Feature or improvement title**
  - **How**: Concrete implementation approach with file paths, function names, patterns to follow. Should be detailed enough that a developer can start coding without further research.
  - **Why**: 1-2 sentences explaining the user-facing or developer-facing value.

---

## Priority Summary

| Priority | Count | Items |
|----------|-------|-------|
| 🔴 Critical | N | ... |
| 🟡 Important | N | ... |
| 🟢 Nice-to-have | N | ... |

### Implementation Order (suggested)
[ordered list of recommended implementation sequence]
```

## Section Categories

Organize items into these sections (merge or split as findings dictate). If a section has no genuine issues, omit it entirely.

1. Visualization & FFT
2. Waveform Display
3. Transport Controls
4. Playback & Stability
5. Performance & Memory
6. Metadata & Display
7. Accessibility
8. Testing

## Quality Standards

- **Every item must reference specific files** — no vague "improve the player" items
- **How sections must be actionable** — describe the approach concretely enough that a developer can start implementing without ambiguity
- **No duplicates** — each improvement appears exactly once in the most relevant section
- **Verify before suggesting** — read the actual code to confirm something is missing before adding it as a goal. Do not guess based on file names alone. If the component already handles a state/feature, do not suggest adding it
- **Specific over generic** — "Add `aria-pressed={isMuted}` to the mute button at line 504" is better than "Improve accessibility". Name the file, the line, the prop
- **User-observable value** — every item should describe a change that a user would notice. Internal refactors must explain the observable benefit (smoother playback, fewer glitches, better errors)

## Rules

- Delete the existing `audio_goals.md` before writing — this is always a fresh analysis
- Do NOT carry over checked items (`[x]`) from the previous `audio_goals.md`
- Do NOT carry over skipped items (`[s]`) from the previous `audio_goals.md` — these were intentionally declined and must not reappear
- Do NOT add items that are already implemented in the codebase — verify by reading the actual code
- Do NOT pad sections — if a section has no real issues, omit it or include only 1-2 genuine items. Quality over quantity
- Match the terse, reference-style tone of CLAUDE.md
- Include every genuine finding — no artificial item count target. Let the findings emerge naturally from the current state of the code
- Run the Explore agents in parallel to minimize wall-clock time
- After writing, count the total items with `grep -c '^\- \[ \]'` and report the count
- Report per-priority breakdown: `grep -c '🔴'`, `grep -c '🟡'`, `grep -c '🟢'`
