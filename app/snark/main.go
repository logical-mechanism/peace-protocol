//go:build !js || !wasm

// Copyright (C) 2025 Logical Mechanism LLC
// SPDX-License-Identifier: GPL-3.0-only

// main.go - CLI entry point (excluded from WASM builds)
package main

import (
	"flag"
	"fmt"
	"io"
	"math/big"
	"os"
)

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

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
