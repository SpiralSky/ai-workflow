FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    xz-utils \
  && rm -rf /var/lib/apt/lists/*

# Install Node.js 22 LTS into /opt/aiw-node
RUN curl -fsSL https://nodejs.org/dist/v22.15.0/node-v22.15.0-linux-x64.tar.xz \
    -o /tmp/node.tar.xz \
  && mkdir -p /opt/aiw-node \
  && tar -xJf /tmp/node.tar.xz -C /opt/aiw-node --strip-components=1 \
  && rm /tmp/node.tar.xz

# Configure git identity (required for git apply inside containers)
RUN git config --global user.email "aiw@local" \
  && git config --global user.name "aiw"

# Mount point for the server bundle
RUN mkdir -p /opt/aiw/bundle

WORKDIR /work
