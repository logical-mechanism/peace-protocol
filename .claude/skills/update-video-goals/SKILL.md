---
name: update-video-goals
description: Regenerate app/gui/video_goals.md with a fresh comprehensive analysis of the VideoPlayer component
---

# Update Video Goals

Delete `video_goals.md` and regenerate it from scratch with a comprehensive analysis of every possible improvement across the VideoPlayer component. Do not carry over completed items or skipped items from the previous round — this is a fresh audit against the current state of the code.

**Design intent:** The VideoPlayer is a desktop video viewer integrated into the Veiled library modal. It uses a native `<video>` element with FFmpeg.wasm remux fallback for unsupported containers. Styling uses Tailwind utilities with CSS variable theming (dark/light). Suggestions should feel native to a polished desktop media library app — not a web-first SPA.

## Process

1. **Read CLAUDE.md** to understand the current architecture, conventions, and gotchas
2. **Read the current video_goals.md** (if it exists) to understand what was previously identified — but do NOT preserve it. The output is a clean slate. Note any items marked `[s]` (skipped) — these were intentionally declined and must NOT be re-suggested in the new goals.
3. **Launch parallel Explore subagents** (all "very thorough") to audit the VideoPlayer:

   **Agent 1 — Playback, Seeking & Transport:**
   - Read the full `VideoPlayer.tsx` component line by line
   - Read the `AudioPlayer.tsx` component for feature parity comparison
   - Read `LibraryContentModal.tsx` for integration point (how data is passed, how the player is mounted)
   - Read `fe/src/config/categories.ts` for supported video formats
   - Identify gaps using this checklist:
     - **Playback reliability**: Does the `<video>` element handle all lifecycle events? Check for `stalled`, `waiting`, `suspend`, `abort`, `emptied`. Is the probe mechanism (8s timeout) robust? Are there race conditions between Blob creation, probe resolution, and FFmpeg remux?
     - **FFmpeg remux reliability**: What happens if CDN is unreachable? Is the WASM load retried on failure? Does the remux handle corrupted input gracefully? Is progress reporting accurate? What happens if remux produces an unplayable output?
     - **Seeking UX**: Can users seek via progress bar click/drag? Is there a visible playback position indicator? Does the seek bar have adequate click target size? Is there a hover time preview? Does seeking work during pause?
     - **Transport completeness**: Play, pause, skip ±5s, speed, mute, volume, fullscreen, PiP, captions — is anything missing? Are keyboard shortcuts comprehensive and discoverable? Does the AudioPlayer have transport features the VideoPlayer lacks?
     - **Format handling**: Are all 6 supported formats (mp4, mkv, avi, mov, webm, m4v) handled correctly? Are MIME types accurate? Does the probe → remux fallback work for each format? Are error messages helpful when a format fails?
     - **Edge cases**: What happens at video end? What about zero-length files? Corrupted files? Files with no video track (audio-only in video container)? Very large files and memory pressure?

   **Agent 2 — Performance & Memory:**
   - Read the FFmpeg.wasm setup and remux pipeline
   - Read the Blob URL lifecycle management
   - Read the probe mechanism implementation
   - Read `fe/src/index.css` for CSS variables, transitions, animations used by the player
   - Identify gaps using this checklist:
     - **Remux performance**: How large a file can be remuxed before hitting memory limits? Is progress reporting smooth or chunky? Could the WASM core be bundled locally instead of fetched from CDN? Is the remuxed output cleaned up from FFmpeg's virtual filesystem?
     - **Blob URL lifecycle**: Are Blob URLs revoked on unmount? On re-render with new data? Are there leak paths where URLs survive component teardown?
     - **Video element lifecycle**: Is the video element properly cleaned up? Are event listeners removed? Is `video.src` cleared on unmount to release GStreamer resources?
     - **Fullscreen performance**: Does the fullscreen overlay cause layout thrash? Is the placeholder text approach efficient? Are control bar re-renders minimized?
     - **Theme support**: Do all CSS variables have light-theme overrides? Does the progress bar, control bar, and error state render correctly in light mode?
     - **Memory management**: Are Uint8Array inputs released after Blob creation? Is the FFmpeg virtual filesystem cleaned up after remux? What's the peak memory usage for a large video file (original + remuxed copy in memory)?

   **Agent 3 — UX, Accessibility & Display:**
   - Read all UI rendering sections of `VideoPlayer.tsx` (the JSX return block)
   - Read the subtitle parsing and display logic
   - Read the error state rendering
   - Read the test file at `fe/src/components/__tests__/VideoPlayer.test.tsx`
   - Identify gaps using this checklist:
     - **Accessibility**: Does the seek bar have `role="slider"` + ARIA attributes? Are playback state changes announced via `aria-live`? Do toggle buttons use `aria-pressed`? Are all interactive elements keyboard-reachable? Is tab order logical? Is the keyboard shortcut overlay accessible?
     - **Loading states**: Is there a loading indicator during probe? During FFmpeg remux? During video buffering? Is the user informed of what's happening at each stage?
     - **Error states**: Are error messages actionable? Do they mention GStreamer plugins, format incompatibility, or suggest exporting? Is the error UI visually distinct? Are there error states that are silently swallowed?
     - **Subtitle UX**: Can users toggle captions on/off? Is the SRT→VTT conversion robust? Are subtitle timing edge cases handled? Is there visual feedback when captions are enabled?
     - **Fullscreen UX**: Does Escape reliably exit fullscreen without closing the modal? Are controls visible/auto-hiding in fullscreen? Is the transition smooth?
     - **Visual polish**: Are transitions smooth? Do buttons have proper hover/active/focus states? Is spacing consistent with the design system? Is the progress bar visually clear?
     - **Test coverage**: What utility functions are tested? What's NOT tested? Are edge cases covered (NaN, Infinity, empty arrays, zero-length video)? Is the probe mechanism tested? Is FFmpeg remux tested?

4. **Synthesize findings** from all agents into a single `video_goals.md` file. Cross-reference between agents to eliminate duplicates. If an area has no genuine issues, do not pad it with filler items.

## Output Format

Write `video_goals.md` with this structure:

```markdown
# VideoPlayer Goals & Improvements

A comprehensive backlog for making the VideoPlayer exceptional. Pick any item, implement it, check it off, and submit a PR.

**Architecture context:**
- Native `<video>` element for playback (routes through GStreamer via WebKitGTK)
- FFmpeg.wasm remux fallback for unsupported containers (MKV, AVI → MP4)
- Format probe mechanism: temporary `<video>` element with 8s timeout
- SRT/VTT subtitle support with automatic format conversion
- Fullscreen overlay mode with capture-phase Escape handling
- Styling uses Tailwind utilities + CSS variables defined in `fe/src/index.css`

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

1. Playback & Stability
2. Seeking & Navigation
3. Transport Controls
4. Format Support & Remuxing
5. Performance & Memory
6. Accessibility
7. Subtitle Support
8. Display & UX

## Quality Standards

- **Every item must reference specific files** — no vague "improve the player" items
- **How sections must be actionable** — describe the approach concretely enough that a developer can start implementing without ambiguity
- **No duplicates** — each improvement appears exactly once in the most relevant section
- **Verify before suggesting** — read the actual code to confirm something is missing before adding it as a goal. Do not guess based on file names alone. If the component already handles a state/feature, do not suggest adding it
- **Specific over generic** — "Add `aria-pressed={isMuted}` to the mute button at line 504" is better than "Improve accessibility". Name the file, the line, the prop
- **User-observable value** — every item should describe a change that a user would notice. Internal refactors must explain the observable benefit (smoother playback, fewer glitches, better errors)

## Rules

- Delete the existing `video_goals.md` before writing — this is always a fresh analysis
- Do NOT carry over checked items (`[x]`) from the previous `video_goals.md`
- Do NOT carry over skipped items (`[s]`) from the previous `video_goals.md` — these were intentionally declined and must not reappear
- Do NOT add items that are already implemented in the codebase — verify by reading the actual code
- Do NOT pad sections — if a section has no real issues, omit it or include only 1-2 genuine items. Quality over quantity
- Match the terse, reference-style tone of CLAUDE.md
- Include every genuine finding — no artificial item count target. Let the findings emerge naturally from the current state of the code
- Run the Explore agents in parallel to minimize wall-clock time
- After writing, count the total items with `grep -c '^\- \[ \]'` and report the count
- Report per-priority breakdown: `grep -c '🔴'`, `grep -c '🟡'`, `grep -c '🟢'`
