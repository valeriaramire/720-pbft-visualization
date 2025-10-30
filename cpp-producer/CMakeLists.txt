cmake_minimum_required(VERSION 3.10)
project(pbft_redpanda_producer CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(PkgConfig REQUIRED)
pkg_check_modules(RDKAFKA REQUIRED rdkafka++)

add_executable(pbft_producer producer.cpp)
target_include_directories(pbft_producer PRIVATE ${RDKAFKA_INCLUDE_DIRS})
target_link_libraries(pbft_producer ${RDKAFKA_LIBRARIES})

