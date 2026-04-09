// Copyright 2025-2026 Logical Mechanism LLC
// SPDX-License-Identifier: Apache-2.0

// gnark-cardano CLI — generic Groth16 proof toolkit for Cardano/Aiken.
//
// This is a skeleton CLI. The circuit-specific code (circuit.go) is generated
// by Claude from the proof.pattern file. This main.go provides the generic
// subcommands that work with any BLS12-381 Groth16 circuit.
//
// Subcommands:
//
//	setup     — compile circuit + trusted setup → ccs.bin, pk.bin, vk.bin, vk.json
//	prove     — generate proof from secrets → proof.bin, witness.bin, vk.json, proof.json, public.json
//	verify    — verify proof from binary files
//	re-export — re-export JSON files from binary artifacts
package main

import (
	"flag"
	"fmt"
	"io"
	"os"
)

// main is the CLI entry point.
func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

// run implements the CLI command dispatch.
func run(args []string, stdout, stderr io.Writer) int {
	if len(args) < 1 {
		fmt.Fprintln(stderr, "usage: snark <setup|prove|verify|re-export> [flags]")
		fmt.Fprintln(stderr, "")
		fmt.Fprintln(stderr, "  setup      compile circuit and run trusted setup")
		fmt.Fprintln(stderr, "  prove      generate a Groth16 proof (circuit-specific)")
		fmt.Fprintln(stderr, "  verify     verify proof from binary files")
		fmt.Fprintln(stderr, "  re-export  re-export JSON from binary artifacts")
		return 2
	}

	switch args[0] {
	case "setup":
		setupCmd := flag.NewFlagSet("setup", flag.ContinueOnError)
		setupCmd.SetOutput(stderr)

		var outDir string
		var force bool
		setupCmd.StringVar(&outDir, "out", "setup", "output directory for setup files")
		setupCmd.BoolVar(&force, "force", false, "overwrite existing setup files")
		if err := setupCmd.Parse(args[1:]); err != nil {
			return 2
		}

		if SetupFilesExist(outDir) && !force {
			fmt.Fprintln(stdout, "Setup files already exist in", outDir, "(use -force to overwrite)")
			return 0
		}

		fmt.Fprintln(stdout, "Compiling circuit and running trusted setup...")
		if err := CircuitSetup(outDir, force); err != nil {
			fmt.Fprintln(stderr, "FAIL:", err)
			return 1
		}

		fmt.Fprintln(stdout, "SUCCESS: setup files written to", outDir)
		return 0

	case "prove":
		proveCmd := flag.NewFlagSet("prove", flag.ContinueOnError)
		proveCmd.SetOutput(stderr)

		var outDir, setupDir, inputFile string
		var test bool
		proveCmd.StringVar(&outDir, "out", "out", "output directory for proof artifacts")
		proveCmd.StringVar(&setupDir, "setup", "setup", "directory containing setup files")
		proveCmd.StringVar(&inputFile, "input", "", "path to JSON file containing circuit inputs")
		proveCmd.BoolVar(&test, "test", false, "use built-in test inputs (circuit-specific)")
		if err := proveCmd.Parse(args[1:]); err != nil {
			return 2
		}

		if !SetupFilesExist(setupDir) {
			fmt.Fprintln(stderr, "error: setup files not found in", setupDir)
			fmt.Fprintln(stderr, "       run 'snark setup -out", setupDir+"' first")
			return 2
		}

		if err := CircuitProve(setupDir, outDir, inputFile, test); err != nil {
			fmt.Fprintln(stderr, "FAIL:", err)
			return 1
		}

		fmt.Fprintln(stdout, "SUCCESS: proof generated and exported to", outDir)
		return 0

	case "verify":
		verifyCmd := flag.NewFlagSet("verify", flag.ContinueOnError)
		verifyCmd.SetOutput(stderr)

		var outDir string
		verifyCmd.StringVar(&outDir, "out", "out", "directory containing vk.bin, proof.bin, witness.bin")
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
		reexportCmd.StringVar(&outDir, "out", "out", "directory containing binary artifacts")
		if err := reexportCmd.Parse(args[1:]); err != nil {
			return 2
		}

		if err := ReExportJSON(outDir); err != nil {
			fmt.Fprintln(stderr, "FAIL:", err)
			return 1
		}

		fmt.Fprintln(stdout, "SUCCESS: JSON files re-exported")
		return 0

	default:
		fmt.Fprintln(stderr, "unknown command:", args[0])
		fmt.Fprintln(stderr, "usage: snark <setup|prove|verify|re-export> [flags]")
		return 2
	}
}
