# Browser Support for gnark Prover

## Decision: Standard Go WASM

After evaluating options, **Standard Go WASM** is the chosen approach for browser support.

### Why This Approach

| Requirement | Standard Go WASM |
|-------------|------------------|
| Circuit unchanged | Yes |
| No forked toolchain | Yes |
| Desktop-focused | Yes |
| Proven to work | Yes ([gnark-browser](https://github.com/phated/gnark-browser)) |

### Rejected Alternatives

| Approach | Reason Rejected |
|----------|-----------------|
| TinyGo WASM | Requires gnark code modifications (CBOR→Gob, hint registry) |
| Circom/snarkjs | Requires circuit rewrite |
| Hybrid architecture | Requires protocol redesign |

---

## Implementation Plan

### Compilation

```bash
GOOS=js GOARCH=wasm go build -o prover.wasm ./...
```

### Architecture

```
┌─────────────────────────────────────────────────────┐
│                     Browser                         │
├─────────────────────────────────────────────────────┤
│  JavaScript                                         │
│  ┌───────────────┐    ┌──────────────────────────┐ │
│  │ User secrets  │───▶│ prover.wasm              │ │
│  │ (a, r)        │    │ - Load proving key       │ │
│  │               │    │ - Create witness         │ │
│  │ Public inputs │───▶│ - Generate Groth16 proof │ │
│  │ (v, w0, w1)   │    │                          │ │
│  └───────────────┘    └──────────┬───────────────┘ │
│                                  │                  │
│                                  ▼                  │
│                       ┌──────────────────────────┐ │
│                       │ proof.json, public.json  │ │
│                       └──────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

### Required Files to Ship

| File | Purpose | Size |
|------|---------|------|
| `prover.wasm` | WASM binary | ~20 MiB |
| `pk.bin` | Proving key | 613 MiB |
| `ccs.bin` | Constraint system | 85 MiB |
| `wasm_exec.js` | Go WASM runtime | ~20 KiB |
| `vk.bin` | Verifying key (not needed in browser) | 2.7 KiB |

**Total browser payload: ~720 MiB uncompressed, ~480 MiB compressed**

### Performance Expectations

| Metric | Expected |
|--------|----------|
| Initial load | 5-10 seconds |
| Proving time | 10-30 seconds |
| Memory usage | 2+ GiB |
| Target devices | Desktop browsers |

**Note**: BLS12-381 is ~30-50% slower than BN254 benchmarks.

---

## Implementation Steps

### Phase 1: Basic WASM Compilation

1. [ ] Create WASM entry point (`wasm_main.go` with `//go:build js && wasm`)
2. [ ] Expose `prove()` function to JavaScript via `syscall/js`
3. [ ] Compile with `GOOS=js GOARCH=wasm`
4. [ ] Test basic loading in browser

### Phase 2: Asset Loading

1. [ ] Embed or fetch `pk.bin` and `ccs.bin`
2. [ ] Load proving key and constraint system in WASM
3. [ ] Handle async loading in JavaScript

### Phase 3: Proving Interface

1. [ ] Accept secrets (a, r) and public inputs from JavaScript
2. [ ] Create witness assignment
3. [ ] Generate proof
4. [ ] Return proof.json and public.json to JavaScript

### Phase 4: Integration

1. [ ] Build JavaScript wrapper for clean API
2. [ ] Add loading/progress UI
3. [ ] Test end-to-end in target web application

---

## Code Structure

```
snark/
├── main.go              # CLI entry point (existing)
├── kappa.go             # Circuit definition (unchanged)
├── export.go            # Serialization (unchanged)
├── wasm/
│   ├── main_wasm.go     # WASM entry point (new)
│   ├── bridge.go        # JS↔Go bridge (new)
│   └── index.html       # Test harness (new)
└── browser-support.md   # This file
```

### Example WASM Entry Point

```go
//go:build js && wasm

package main

import (
    "syscall/js"
)

func prove(this js.Value, args []js.Value) interface{} {
    // 1. Parse secrets and public inputs from args
    // 2. Load proving key (pre-loaded or fetched)
    // 3. Create witness
    // 4. Generate proof
    // 5. Return JSON result
}

func main() {
    js.Global().Set("gnarkProve", js.FuncOf(prove))
    select {} // Keep alive
}
```

### Example JavaScript Usage

```javascript
const go = new Go();
WebAssembly.instantiateStreaming(fetch("prover.wasm"), go.importObject)
  .then((result) => {
    go.run(result.instance);

    // Now gnarkProve is available
    const proof = gnarkProve(
      secretA,    // hex string
      secretR,    // hex string
      publicV,    // hex compressed G1
      publicW0,   // hex compressed G1
      publicW1    // hex compressed G1
    );
  });
```

---

## Optimizations

### Reduce Initial Load Time

- **Pre-compile constraint system**: Ship `ccs.bin` instead of compiling in browser
- **Split proving key loading**: Load async while showing UI
- **Use Web Workers**: Keep UI responsive during proving

### Reduce Binary Size (if needed)

```bash
# Strip debug info
GOOS=js GOARCH=wasm go build -ldflags="-s -w" -o prover.wasm

# Compress with Brotli (browsers decompress automatically)
brotli -9 prover.wasm
```

---

## References

- [gnark-browser experiment](https://github.com/phated/gnark-browser)
- [Go WebAssembly Wiki](https://go.dev/wiki/WebAssembly)
- [gnark WASM Issue #74](https://github.com/Consensys/gnark/issues/74)
- [Vocdoni gnark WASM research](https://hackmd.io/@vocdoni/B1VPA99Z3) (TinyGo approach, for reference)

---

## Deployment Notes

### File Size Reality

The circuit uses emulated BLS12-381 pairings which result in **1-2 million constraints**. This is why the proving key is so large:

| File | Uncompressed | Compressed (est.) |
|------|--------------|-------------------|
| `pk.bin` | 613 MiB | ~400 MiB |
| `ccs.bin` | 85 MiB | ~70 MiB |
| `prover.wasm` | ~20 MiB | ~8 MiB |
| **Total** | **~720 MiB** | **~480 MiB** |

This is normal for pairing-based Groth16 circuits. Projects like Zcash and Tornado Cash had similar multi-hundred-MB downloads.

### Delivery Strategy

1. **CDN with Brotli/gzip** - Serve compressed, browsers decompress automatically
2. **IndexedDB caching** - Store files after first download; subsequent visits skip download
3. **Progress UI** - Show download progress with estimated time
4. **Background download** - Let users explore the app while files download
5. **Chunked loading** - Consider splitting `pk.bin` if partial loading is possible

### User Experience

- **First visit**: ~480 MB download + 10-30s proving = expect 1-5 min total (connection dependent)
- **Return visits**: Cached files, just 10-30s proving time
- **Recommendation**: Add a simple game or educational content during the wait

---

## Gotchas and Considerations

### Technical

| Issue | Details | Solution |
|-------|---------|----------|
| **Web Workers required** | Proving blocks main thread for 10-30s, freezing UI | Run WASM in a Web Worker |
| **wasm_exec.js version** | Must match Go compiler version exactly | Ship alongside `prover.wasm`, don't use CDN version |
| **Memory limits vary** | Chrome generous, Safari/Firefox stricter | Test across browsers, fail gracefully |
| **Safari quirks** | WebKit has historical WASM memory issues | Thorough Safari testing required |
| **No file I/O** | `os.ReadFile`/`os.WriteFile` don't work in browser | Receive bytes from JS, return bytes to JS |
| **Randomness** | Must use crypto-secure randomness | Verify `crypto/rand` uses `crypto.getRandomValues()` |
| **GC pauses** | Go's garbage collector can cause stutters | Accept or tune GOGC if possible |

### Security

| Issue | Details | Solution |
|-------|---------|----------|
| **Proving key integrity** | Tampered `pk.bin` = invalid/exploitable proofs | Ship hash, verify after download |
| **CORS headers** | Binary files need proper headers | Configure CDN: `Access-Control-Allow-Origin` |
| **Secrets in memory** | Sensitive data lingers after proving | Zero out secret values after use if possible |
| **HTTPS required** | WASM + crypto requires secure context | Serve over HTTPS only |

### UX

| Issue | Details | Solution |
|-------|---------|----------|
| **Mobile detection** | Mobile devices will fail or perform poorly | Detect and warn before 480 MB download |
| **Download interruption** | Connection drop wastes bandwidth | Chunked downloads with resume, or clear messaging |
| **Tab closing** | Users may close during long prove | `beforeunload` warning during proving |
| **Error recovery** | Proving can fail (OOM, etc.) | Graceful error handling, retry option |
| **Progress feedback** | Users need to know something is happening | Progress bar for download, spinner/animation for proving |

### Browser Compatibility Checklist

- [ ] Chrome (primary target)
- [ ] Firefox
- [ ] Safari (test thoroughly)
- [ ] Edge
- [ ] Verify minimum browser versions for WASM + BigInt support
