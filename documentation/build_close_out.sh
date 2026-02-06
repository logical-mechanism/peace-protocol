#!/usr/bin/env bash
set -e

pandoc close_out_report.md --citeproc -o close_out_report.pdf
