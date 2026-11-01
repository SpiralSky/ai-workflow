# Build from repository root: docker build -f experiments/docker/aiw-base/Dockerfile -t aiw-base:latest .
FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    ripgrep \
    curl \
    xz-utils \
  && rm -rf /var/lib/apt/lists/*

# Install Node.js 22 LTS into /opt/aiw-node
RUN curl -fsSL https://nodejs.org/dist/v22.15.0/node-v22.15.0-linux-x64.tar.xz \
    -o /tmp/node.tar.xz \
  && mkdir -p /opt/aiw-node \
  && tar -xJf /tmp/node.tar.xz -C /opt/aiw-node --strip-components=1 \
  && rm /tmp/node.tar.xz

# The sidecar's analysis tools stay outside the task interpreter and workspace.
# One canonical requirements file; repository-root context avoids duplicated dependency pins.
ENV PATH="/opt/aiw-node/bin:${PATH}"
COPY packages/tools/python/requirements.txt /opt/aiw/requirements.txt
RUN python3.12 -m venv /opt/aiw/venv \
  && /opt/aiw/venv/bin/pip install --no-cache-dir -r /opt/aiw/requirements.txt \
  && /opt/aiw/venv/bin/pip check \
  && /opt/aiw/venv/bin/pyright --version \
  && /opt/aiw/venv/bin/ruff --version

# Configure git identity (required for git apply inside containers)
RUN git config --global user.email "aiw@local" \
  && git config --global user.name "aiw"

# Mount point for the server bundle
RUN mkdir -p /opt/aiw/bundle

WORKDIR /work
