package main

import (
	"flag"
	"fmt"
	"os"
)

func main() {
	if len(os.Args) < 2 {
		os.Exit(2)
	}

	switch os.Args[1] {
	case "hash":
		hashCmd := flag.NewFlagSet("hash", flag.ExitOnError)
		var a uint64
		hashCmd.Uint64Var(&a, "a", 0, "secret integer a")
		_ = hashCmd.Parse(os.Args[2:])

		if a == 0 {
			fmt.Fprintln(os.Stderr, "error: -a is required")
			hashCmd.Usage()
			os.Exit(2)
		}

		hkHex, _, err := gtToHash(a)
		if err != nil {
			fmt.Fprintln(os.Stderr, "error:", err)
			os.Exit(1)
		}

		// Print ONLY the hash (easy for Python subprocess to consume)
		fmt.Println(hkHex)

	case "decrypt":
		decryptCmd := flag.NewFlagSet("decrypt", flag.ExitOnError)
		var g1b string
		var g2b string
		var r1 string
		var shared string

		decryptCmd.StringVar(&g1b, "g1b", "", "G1 compressed hex (entry fields[1].fields[0].bytes)")
		decryptCmd.StringVar(&g2b, "g2b", "", "optional G2 compressed hex (entry fields[1].fields[1].fields[0].bytes); omit/empty for constructor==1 branch")
		decryptCmd.StringVar(&r1, "r1", "", "G1 compressed hex (entry fields[0].bytes)")
		decryptCmd.StringVar(&shared, "shared", "", "G2 compressed hex (current shared)")
		_ = decryptCmd.Parse(os.Args[2:])

		if g1b == "" || r1 == "" || shared == "" {
			fmt.Fprintln(os.Stderr, "error: -g1b, -r1, and -shared are required (and optionally -g2b)")
			decryptCmd.Usage()
			os.Exit(2)
		}

		out, err := DecryptToHash(g1b, g2b, r1, shared)
		if err != nil {
			fmt.Fprintln(os.Stderr, "error:", err)
			os.Exit(1)
		}

		// Print ONLY the hash (easy for Python subprocess to consume)
		fmt.Println(out)

	case "prove":
		proveCmd := flag.NewFlagSet("prove", flag.ExitOnError)
		var a uint64
		var w string
		proveCmd.Uint64Var(&a, "a", 0, "secret integer a")
		proveCmd.StringVar(&w, "w", "", "public G1 point W (compressed hex, 96 chars)")
		_ = proveCmd.Parse(os.Args[2:])

		if w == "" {
			fmt.Fprintln(os.Stderr, "error: -w is required")
			proveCmd.Usage()
			os.Exit(2)
		}

		if err := ProveAndVerifyW(a, w); err != nil {
			fmt.Println("FAIL:", err)
			os.Exit(1)
		}

		fmt.Println("SUCCESS: proof verified (W == [hk]q)")

	default:
		os.Exit(2)
	}
}
