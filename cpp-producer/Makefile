CXX ?= g++
CXXFLAGS ?= -O2 -std=c++17
PKGCONF ?= pkg-config

all: pbft_producer

pbft_producer: producer.cpp
	$(CXX) $(CXXFLAGS) $< -o $@ `$(PKGCONF) --cflags --libs rdkafka++`

clean:
	rm -f pbft_producer

.PHONY: all clean

