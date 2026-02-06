#!/usr/bin/env bash
set -e

pandoc technical_report.md --citeproc -o technical_report.pdf
