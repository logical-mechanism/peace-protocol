#!/usr/bin/env bash

set -e

go mod tidy
go build -o snark
GOOS=js GOARCH=wasm go build -o prover.wasm .
