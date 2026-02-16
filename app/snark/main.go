//go:build !js || !wasm

// Copyright (C) 2025 Logical Mechanism LLC
// SPDX-License-Identifier: GPL-3.0-only

// main.go - CLI entry point (excluded from WASM builds)
package main

import (
	"encoding/hex"
	"flag"
	"fmt"
	"io"
	"math/big"
	"os"
)

// main is the native CLI entry point. It delegates to run() and exits with
// the returned status code. Excluded from WASM builds via the build tag.
func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

// run implements the CLI command dispatch. It parses the first positional argument
// as a subcommand (setup, hash, decrypt, prove, verify, re-export, debug-verify,
// test-verify) and delegates to the appropriate handler. Returns 0 on success,
// 1 on operational failure, or 2 on usage/argument errors.
func run(args []string, stdout, stderr io.Writer) int {
	if len(args) < 1 {
		return 2
	}

	switch args[0] {
	case "setup":
		setupCmd := flag.NewFlagSet("setup", flag.ContinueOnError)
		setupCmd.SetOutput(stderr)

		var outDir string
		var force bool
		setupCmd.StringVar(&outDir, "out", "setup", "output directory for setup files (ccs.bin, pk.bin, vk.bin)")
		setupCmd.BoolVar(&force, "force", false, "overwrite existing setup files")
		if err := setupCmd.Parse(args[1:]); err != nil {
			return 2
		}

		if SetupFilesExist(outDir) && !force {
			fmt.Fprintln(stdout, "Setup files already exist in", outDir, "(use -force to overwrite)")
			return 0
		}

		fmt.Fprintln(stdout, "Compiling circuit and running trusted setup...")
		if err := SetupVW0W1Circuit(outDir, force); err != nil {
			fmt.Fprintln(stderr, "FAIL:", err)
			return 1
		}

		fmt.Fprintln(stdout, "SUCCESS: setup files written to", outDir)
		return 0

	case "hash":
		hashCmd := flag.NewFlagSet("hash", flag.ContinueOnError)
		hashCmd.SetOutput(stderr)

		var aStr string
		hashCmd.StringVar(&aStr, "a", "", "secret integer a (decimal by default; or 0x... hex)")
		if err := hashCmd.Parse(args[1:]); err != nil {
			return 2
		}

		if aStr == "" {
			fmt.Fprintln(stderr, "error: -a is required")
			hashCmd.Usage()
			return 2
		}

		a := new(big.Int)
		if _, ok := a.SetString(aStr, 0); !ok || a.Sign() == 0 {
			fmt.Fprintln(stderr, "error: could not parse -a (must be a non-zero integer; decimal or 0x.. hex)")
			return 2
		}

		hkHex, _, err := gtToHash(a)
		if err != nil {
			fmt.Fprintln(stderr, "error:", err)
			return 1
		}

		fmt.Fprintln(stdout, hkHex)
		return 0

	case "decrypt":
		decryptCmd := flag.NewFlagSet("decrypt", flag.ContinueOnError)
		decryptCmd.SetOutput(stderr)

		var g1b, g2b, r1, shared string
		decryptCmd.StringVar(&g1b, "g1b", "", "G1 compressed hex (entry fields[1].fields[0].bytes)")
		decryptCmd.StringVar(&g2b, "g2b", "", "optional G2 compressed hex (entry fields[1].fields[1].fields[0].bytes); omit/empty for constructor==1 branch")
		decryptCmd.StringVar(&r1, "r1", "", "G1 compressed hex (entry fields[0].bytes)")
		decryptCmd.StringVar(&shared, "shared", "", "G2 compressed hex (current shared)")
		if err := decryptCmd.Parse(args[1:]); err != nil {
			return 2
		}

		if g1b == "" || r1 == "" || shared == "" {
			fmt.Fprintln(stderr, "error: -g1b, -r1, and -shared are required (and optionally -g2b)")
			decryptCmd.Usage()
			return 2
		}

		out, err := DecryptToHash(g1b, g2b, r1, shared)
		if err != nil {
			fmt.Fprintln(stderr, "error:", err)
			return 1
		}

		fmt.Fprintln(stdout, out)
		return 0

	case "prove":
		proveCmd := flag.NewFlagSet("prove", flag.ContinueOnError)
		proveCmd.SetOutput(stderr)

		var aStr, rStr, v, w0, w1, outDir, setupDir string
		var noVerify bool
		proveCmd.StringVar(&aStr, "a", "", "secret integer a (decimal by default; or 0x... hex)")
		proveCmd.StringVar(&rStr, "r", "", "secret integer r (decimal by default; or 0x... hex; can be 0)")
		proveCmd.StringVar(&v, "v", "", "public G1 point V (compressed hex, 96 chars)")
		proveCmd.StringVar(&w0, "w0", "", "public G1 point W0 (compressed hex, 96 chars)")
		proveCmd.StringVar(&w1, "w1", "", "public G1 point W1 (compressed hex, 96 chars)")
		proveCmd.StringVar(&outDir, "out", "out", "output directory for vk.json / proof.json / public.json")
		proveCmd.StringVar(&setupDir, "setup", "", "directory containing setup files (ccs.bin, pk.bin, vk.bin); if empty, compiles circuit fresh")
		proveCmd.BoolVar(&noVerify, "no-verify", false, "skip verification after proving (only valid with -setup)")
		if err := proveCmd.Parse(args[1:]); err != nil {
			return 2
		}

		missing := false
		if aStr == "" {
			fmt.Fprintln(stderr, "error: -a is required")
			missing = true
		}
		if rStr == "" {
			fmt.Fprintln(stderr, "error: -r is required")
			missing = true
		}
		if v == "" {
			fmt.Fprintln(stderr, "error: -v is required")
			missing = true
		}
		if w0 == "" {
			fmt.Fprintln(stderr, "error: -w0 is required")
			missing = true
		}
		if w1 == "" {
			fmt.Fprintln(stderr, "error: -w1 is required")
			missing = true
		}
		if missing {
			proveCmd.Usage()
			return 2
		}

		a := new(big.Int)
		if _, ok := a.SetString(aStr, 0); !ok || a.Sign() == 0 {
			fmt.Fprintln(stderr, "error: could not parse -a (must be a non-zero integer; decimal or 0x.. hex)")
			return 2
		}

		r := new(big.Int)
		if _, ok := r.SetString(rStr, 0); !ok {
			fmt.Fprintln(stderr, "error: could not parse -r (must be an integer; decimal or 0x.. hex)")
			return 2
		}

		// Use setup files if provided, otherwise compile fresh
		if setupDir != "" {
			if !SetupFilesExist(setupDir) {
				fmt.Fprintln(stderr, "error: setup files not found in", setupDir)
				fmt.Fprintln(stderr, "       run 'snark setup -out", setupDir+"' first")
				return 2
			}
			if err := ProveVW0W1FromSetup(setupDir, outDir, a, r, v, w0, w1, !noVerify); err != nil {
				fmt.Fprintln(stderr, "FAIL:", err)
				return 1
			}
		} else {
			if noVerify {
				fmt.Fprintln(stderr, "warning: -no-verify is ignored without -setup")
			}
			if err := ProveAndVerifyVW0W1(a, r, v, w0, w1, outDir); err != nil {
				fmt.Fprintln(stderr, "FAIL:", err)
				return 1
			}
		}

		fmt.Fprintln(stdout, "SUCCESS: proof verified (w0 == [hk]q AND w1 == [a]q + [r]v)")
		return 0

	case "verify":
		verifyCmd := flag.NewFlagSet("verify", flag.ContinueOnError)
		verifyCmd.SetOutput(stderr)

		var outDir string
		verifyCmd.StringVar(&outDir, "out", "out", "directory containing vk.bin, proof.bin, and public.json")
		if err := verifyCmd.Parse(args[1:]); err != nil {
			return 2
		}

		if err := VerifyFromFiles(outDir); err != nil {
			fmt.Fprintln(stderr, "FAIL:", err)
			return 1
		}

		fmt.Fprintln(stdout, "SUCCESS: proof verified")
		return 0

	case "re-export":
		reexportCmd := flag.NewFlagSet("re-export", flag.ContinueOnError)
		reexportCmd.SetOutput(stderr)

		var outDir string
		reexportCmd.StringVar(&outDir, "out", "out", "directory containing vk.bin, proof.bin, and witness.bin")
		if err := reexportCmd.Parse(args[1:]); err != nil {
			return 2
		}

		if err := ReExportJSON(outDir); err != nil {
			fmt.Fprintln(stderr, "FAIL:", err)
			return 1
		}

		fmt.Fprintln(stdout, "SUCCESS: JSON files re-exported")
		return 0

	case "ceremony":
		if len(args) < 2 {
			fmt.Fprintln(stderr, "usage: snark ceremony <init|contribute|verify|finalize> [flags]")
			return 2
		}
		switch args[1] {
		case "init":
			initCmd := flag.NewFlagSet("ceremony init", flag.ContinueOnError)
			initCmd.SetOutput(stderr)
			var dir string
			var force bool
			initCmd.StringVar(&dir, "dir", "ceremony", "ceremony directory")
			initCmd.BoolVar(&force, "force", false, "overwrite existing ceremony")
			if err := initCmd.Parse(args[2:]); err != nil {
				return 2
			}
			fmt.Fprintln(stdout, "Compiling circuit and initializing ceremony...")
			if err := CeremonyInit(dir, force); err != nil {
				fmt.Fprintln(stderr, "FAIL:", err)
				return 1
			}
			fmt.Fprintln(stdout, "SUCCESS: ceremony initialized in", dir)
			return 0

		case "contribute":
			contribCmd := flag.NewFlagSet("ceremony contribute", flag.ContinueOnError)
			contribCmd.SetOutput(stderr)
			var dir string
			var phase int
			contribCmd.StringVar(&dir, "dir", "ceremony", "ceremony directory")
			contribCmd.IntVar(&phase, "phase", 0, "phase number (1 or 2)")
			if err := contribCmd.Parse(args[2:]); err != nil {
				return 2
			}
			if phase != 1 && phase != 2 {
				fmt.Fprintln(stderr, "error: -phase must be 1 or 2")
				return 2
			}
			var idx int
			var hash string
			var err error
			if phase == 1 {
				idx, hash, err = CeremonyContributePhase1(dir)
			} else {
				idx, hash, err = CeremonyContributePhase2(dir)
			}
			if err != nil {
				fmt.Fprintln(stderr, "FAIL:", err)
				return 1
			}
			fmt.Fprintf(stdout, "SUCCESS: phase %d contribution #%04d\n", phase, idx)
			fmt.Fprintf(stdout, "  sha256: %s\n", hash)
			return 0

		case "verify":
			verifyCmd := flag.NewFlagSet("ceremony verify", flag.ContinueOnError)
			verifyCmd.SetOutput(stderr)
			var dir string
			var phase int
			verifyCmd.StringVar(&dir, "dir", "ceremony", "ceremony directory")
			verifyCmd.IntVar(&phase, "phase", 0, "phase number (1 or 2)")
			if err := verifyCmd.Parse(args[2:]); err != nil {
				return 2
			}
			if phase != 1 && phase != 2 {
				fmt.Fprintln(stderr, "error: -phase must be 1 or 2")
				return 2
			}
			var count int
			var err error
			if phase == 1 {
				count, err = CeremonyVerifyPhase1(dir)
			} else {
				count, err = CeremonyVerifyPhase2(dir)
			}
			if err != nil {
				fmt.Fprintln(stderr, "FAIL:", err)
				return 1
			}
			fmt.Fprintf(stdout, "SUCCESS: all %d phase %d contributions verified\n", count, phase)
			return 0

		case "finalize":
			finalizeCmd := flag.NewFlagSet("ceremony finalize", flag.ContinueOnError)
			finalizeCmd.SetOutput(stderr)
			var dir string
			var phase int
			var beaconHex string
			finalizeCmd.StringVar(&dir, "dir", "ceremony", "ceremony directory")
			finalizeCmd.IntVar(&phase, "phase", 0, "phase number (1 or 2)")
			finalizeCmd.StringVar(&beaconHex, "beacon", "", "random beacon hex string")
			if err := finalizeCmd.Parse(args[2:]); err != nil {
				return 2
			}
			if phase != 1 && phase != 2 {
				fmt.Fprintln(stderr, "error: -phase must be 1 or 2")
				return 2
			}
			if beaconHex == "" {
				fmt.Fprintln(stderr, "error: -beacon is required")
				return 2
			}
			beacon, err := hex.DecodeString(beaconHex)
			if err != nil {
				fmt.Fprintln(stderr, "error: invalid beacon hex:", err)
				return 2
			}

			if phase == 1 {
				fmt.Fprintln(stdout, "Finalizing phase 1...")
				if err := CeremonyFinalizePhase1(dir, beacon); err != nil {
					fmt.Fprintln(stderr, "FAIL:", err)
					return 1
				}
				fmt.Fprintln(stdout, "SUCCESS: phase 1 finalized, phase 2 initialized")
				fmt.Fprintln(stdout, "  commons.bin and phase2_0000.bin written to", dir)
			} else {
				fmt.Fprintln(stdout, "Finalizing phase 2...")
				if err := CeremonyFinalizePhase2(dir, beacon); err != nil {
					fmt.Fprintln(stderr, "FAIL:", err)
					return 1
				}
				fmt.Fprintln(stdout, "SUCCESS: phase 2 finalized, keys extracted")
				fmt.Fprintln(stdout, "  pk.bin, vk.bin, vk.json written to", dir)
			}
			return 0

		default:
			fmt.Fprintln(stderr, "unknown ceremony subcommand:", args[1])
			fmt.Fprintln(stderr, "usage: snark ceremony <init|contribute|verify|finalize> [flags]")
			return 2
		}

	case "debug-verify":
		debugVerify()
		return 0

	case "test-verify":
		testVerify()
		return 0

	default:
		return 2
	}
}
