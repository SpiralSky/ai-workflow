#!/bin/sh
set -eu
cd "${WORKSPACE:-/work}"
python3 -m unittest discover -s checks -p "test_*.py" -v
python3 -m unittest discover -s checks/regression -p "test_*.py" -q
python3 -m unittest discover -s tests -p "test_*.py" -q
