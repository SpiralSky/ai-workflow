#!/bin/sh
set -e
cd /work
cp checks/test_hidden.py .
python -m unittest discover -s . -p "test_*.py" -v
