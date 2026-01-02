// Copyright (C) 2025 Logical Mechanism LLC
// SPDX-License-Identifier: GPL-3.0-only

// main.go
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

		var aStr, rStr, v, w0, w1, outDir string
		proveCmd.StringVar(&aStr, "a", "", "secret integer a (decimal by default; or 0x... hex)")
		proveCmd.StringVar(&rStr, "r", "", "secret integer r (decimal by default; or 0x... hex; can be 0)")
		proveCmd.StringVar(&v, "v", "", "public G1 point V (compressed hex, 96 chars)")
		proveCmd.StringVar(&w0, "w0", "", "public G1 point W0 (compressed hex, 96 chars)")
		proveCmd.StringVar(&w1, "w1", "", "public G1 point W1 (compressed hex, 96 chars)")
		proveCmd.StringVar(&outDir, "out", "out", "output directory for vk.json / proof.json / public.json")
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

		if err := ProveAndVerifyVW0W1(a, r, v, w0, w1, outDir); err != nil {
			fmt.Fprintln(stderr, "FAIL:", err)
			return 1
		}

		fmt.Fprintln(stdout, "SUCCESS: proof verified (w0 == [hk]q AND w1 == [a]q + [r]v)")
		return 0

	default:
		return 2
	}
}
