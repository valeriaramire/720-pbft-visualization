// Minimal stdin -> Redpanda producer (Kafka API via librdkafka++)
// Usage: pbft_producer <brokers> <topic>
// Example: ./pbft_client | ./pbft_producer localhost:9092 pbft.logs

#include <iostream>
#include <string>
#include <memory>

#include <rdkafka/rdkafkacpp.h>

int main(int argc, char** argv) {
    if (argc < 3) {
        std::cerr << "Usage: " << argv[0] << " <brokers> <topic>\n";
        return 2;
    }
    const std::string brokers = argv[1];
    const std::string topic = argv[2];

    std::string errstr;
    std::unique_ptr<RdKafka::Conf> conf(RdKafka::Conf::create(RdKafka::Conf::CONF_GLOBAL));
    if (!conf) {
        std::cerr << "Failed to create conf\n";
        return 1;
    }
    if (conf->set("bootstrap.servers", brokers, errstr) != RdKafka::Conf::CONF_OK) {
        std::cerr << errstr << "\n";
        return 1;
    }

    std::unique_ptr<RdKafka::Producer> producer(RdKafka::Producer::create(conf.get(), errstr));
    if (!producer) {
        std::cerr << "Failed to create producer: " << errstr << "\n";
        return 1;
    }

    std::string line;
    while (std::getline(std::cin, line)) {
        if (!line.empty() && line.back() == '\r') line.pop_back();
        RdKafka::ErrorCode err = producer->produce(
            topic, RdKafka::Topic::PARTITION_UA,
            RdKafka::Producer::RK_MSG_COPY,
            const_cast<char*>(line.data()), (int)line.size(),
            nullptr, 0, 0, nullptr);
        if (err != RdKafka::ERR_NO_ERROR) {
            std::cerr << "produce failed: " << RdKafka::err2str(err) << "\n";
        }
        producer->poll(0);
    }

    while (producer->outq_len() > 0) {
        producer->poll(100);
    }
    return 0;
}
