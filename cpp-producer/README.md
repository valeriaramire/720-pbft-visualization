PBFT Stdout → Redpanda Producer (C++)

Overview
- Reads lines from stdin and produces them to a Redpanda/Kafka topic.
- Minimal, no extra flags: pass brokers and topic as positional args.

Build (choose one)
- CMake
  - Install `librdkafka` dev headers
    - Ubuntu/Debian: `sudo apt-get install -y librdkafka-dev`
    - macOS (Homebrew): `brew install librdkafka`
  - `cd cpp-producer && cmake -S . -B build && cmake --build build -j`
- Makefile (pkg-config)
  - Requires `pkg-config` and `librdkafka++`
  - `cd cpp-producer && make`

Usage
- Produce stdin to Redpanda:
  - `./pbft_producer localhost:9092 pbft.logs`
- Wrap a PBFT client:
  - `./pbft_client | ./pbft_producer localhost:9092 pbft.logs`

Notes
- Redpanda is Kafka API compatible; this uses `librdkafka` C++ API.
