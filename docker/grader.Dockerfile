# The grader snapshot: Stockfish and `lcchess` for the review app's Analyze button.
# Built by scripts/grader-snapshot.py, whose build context holds the wheels of the three
# workspace packages and the locked requirements; `mise run review:snapshot` runs it.
FROM ubuntu:24.04

# ca-certificates: the sandbox adds its proxy's CA to this bundle, which access delegation needs.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

# Stockfish 19 (GPL-3.0), unmodified, with its licence and authors. Source:
# https://github.com/official-stockfish/Stockfish/tree/sf_19. Bump with mise.toml's pin and checksum.
ARG STOCKFISH_URL=https://github.com/official-stockfish/Stockfish/releases/download/sf_19/stockfish-linux-x86-64-universal.tar.gz
ARG STOCKFISH_SHA256=9defc0d4e55d49c65a6d042f3e571a39fcea499ade6dbe741b53b8c65e03611f
RUN curl -fsSLo /tmp/stockfish.tar.gz "$STOCKFISH_URL" \
  && echo "$STOCKFISH_SHA256  /tmp/stockfish.tar.gz" | sha256sum -c - \
  && tar -xzf /tmp/stockfish.tar.gz -C /tmp \
  && install -m 0755 /tmp/stockfish/stockfish-linux-x86-64-universal /usr/local/bin/stockfish \
  && mkdir -p /usr/share/doc/stockfish \
  && cp /tmp/stockfish/Copying.txt /tmp/stockfish/AUTHORS /tmp/stockfish/README.md \
    /usr/share/doc/stockfish/ \
  && printf 'Stockfish 19, unmodified. Source: %s\n' \
    https://github.com/official-stockfish/Stockfish/tree/sf_19 > /usr/share/doc/stockfish/SOURCE \
  && rm -rf /tmp/stockfish /tmp/stockfish.tar.gz

COPY --from=ghcr.io/astral-sh/uv:0.12 /uv /usr/local/bin/uv

# The interpreter lives outside the build's cache so the venv keeps working in the snapshot.
ENV UV_PYTHON_INSTALL_DIR=/opt/python UV_NO_CACHE=1
COPY requirements.txt /tmp/lcchess/requirements.txt
COPY wheels/ /tmp/lcchess/wheels/
RUN uv venv --python 3.13 /opt/lcchess \
  && VIRTUAL_ENV=/opt/lcchess uv pip install -r /tmp/lcchess/requirements.txt \
  && VIRTUAL_ENV=/opt/lcchess uv pip install --no-deps /tmp/lcchess/wheels/*.whl \
  && rm -rf /tmp/lcchess

ENV PATH=/opt/lcchess/bin:$PATH STOCKFISH_PATH=/usr/local/bin/stockfish
