#!/bin/sh
set -eu
export PYTHONDONTWRITEBYTECODE=1
cd "${WORKSPACE:-/work}"
python3.12 -B -m unittest discover -s checks -p "test_*.py" -v
python3.12 -B -m unittest discover -s checks/regression -p "test_*.py" -q
python3.12 -B -m unittest discover -s tests -p "test_*.py" -q
