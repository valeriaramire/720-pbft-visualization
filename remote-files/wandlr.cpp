/**
 * @author Jelle Hellings
 *
 * @license
 * Copyright 2025 Jelle Hellings.
 * For internal use only.
 *
 * @description
 * The Workload and Log Replication tool.
 */
#include <algorithm>
#include <cassert>
#include <iostream>
#include <map>
#include <stdexcept>
#include <thread>
#include <sstream>
#include <vector>
#include <curl/curl.h>

constexpr static char helper_message[] =
        "Usage: wandlr mode options...\n"
        "       wandlr w url cid wait rounds\n"
        "       wandlr lr url pid\n"
        "\n"
        "In mode w (workload), wandlr will send 'rounds' POST requests to url with\n"
        "arguments 'client_id' (set to cid) and 'next_rank' (starting at zero).\n"
        "For each response it prints the response and increments 'next_rank'.\n"
        "The duration between requests is 'wait' seconds.\n"
        "\n"
        "In mode lr (log redirect), wandlr will read input from standard input. Each\n"
        "input sentence (terminated by new line) will be sent via a POST request to url\n"
        "with arguments 'participant_id' (set to pid) and 'data' (set to the input\n"
        "sentence.\n"
        "\n";


/*
 * Helper class to manage a CURL-created char-pointer.
 */
class curl_escaped_pointer
{
private:
    /* A CURL-created char-pointer. */
    char* ptr;

public:
    /*
     * Store the CURL-created char pointer @{pointer}.
     */
    curl_escaped_pointer(char* pointer) : ptr(pointer)
    {
        if (ptr == nullptr) {
            throw std::runtime_error("CURL escape failure");
        }
    }

    /*
     * Clean-up the CURL-created char-pointer.
     */
    ~curl_escaped_pointer()
    {
        curl_free(ptr);
        ptr = nullptr;
    }


    /*
     * Return the string representation of the internal char-pointer.
     */
    std::string str() const
    {
        return {ptr};
    }
};


/*
 * Helper class to manage a CURL handle and send POST reqests.
 */
class curl_handle
{
private:
    /* The CURL handle. */
    CURL* handle;

    /* Buffer for response data, written to via @{write_callback}. */
    std::vector<char> response;


    /*
     * Internal callback used by @{curl_easy_perform} to write the response on a
     * request to an internal buffer. The callback received @{nmemb} bytes, each
     * of size @{size} (which is 1), via pointer @{ptr}. The pointer @{self_ptr}
     * will point to this @{curl_handle} object.
     */
    static std::size_t write_callback(char* ptr,
                                      std::size_t size,
                                      std::size_t nmemb,
                                      void* self_ptr)
    {
        assert(size == 1);
        curl_handle& self = *static_cast<curl_handle*>(self_ptr);

        auto current_size = self.response.size();
        self.response.resize(current_size + nmemb);
        std::copy(ptr, ptr + nmemb, self.response.data() + current_size);
        return nmemb;
    }


    /*
     * Set the handle option @{opt} with argument @{arg} and throw an exception
     * upon failure.
     */    
    void internal_set(CURLoption opt, auto arg)
    {
        auto r = curl_easy_setopt(handle, opt, arg);
        if (r != CURLE_OK) {
            throw std::runtime_error("CURL set option failure " + std::to_string(r));
        }
    }

    /*
     * Escape the string @{str} for safe use in HTTP URLs.
     */
    std::string url_escape(const std::string& str)
    {
        curl_escaped_pointer ptr(curl_easy_escape(handle, str.c_str(), str.size()));
        return ptr.str();
    }

    std::string url_escape(const char* str_ptr)
    {
        curl_escaped_pointer ptr(curl_easy_escape(handle, str_ptr, 0));
        return ptr.str();
    }


public:
    /*
     * Construct a CURL handle ready for sending requests.
     */
    curl_handle() : handle(nullptr)
    {
        auto r = curl_global_init(CURL_GLOBAL_DEFAULT);
        if (r != CURLE_OK) {
            throw std::runtime_error("CURL global initialization failure " + std::to_string(r));
        }

        handle = curl_easy_init();
        if (handle == nullptr) {
            throw std::runtime_error("CURL handle initialization failure");
        }
    }

    /*
     * Destroy and clean-up the CURL handle.
     */
    ~curl_handle()
    {
        if (handle != nullptr) {
            curl_easy_cleanup(handle);
        }
        handle = nullptr;
    }


private:
    /*
     * Encode the POST request data string with field-value pair @{field} and
     * @{value} and write the encoding to output @{out}. Use @{delim} to
     * separate this field-value pair from preceding pairs.
     */
    void post_key_values(std::ostream& out, const auto& delim,
                         const auto& field, const auto& value,
                         const auto&... args)
    {
        out << delim << url_escape(field) << '=' << url_escape(value);
        if constexpr (sizeof...(args) != 0) {
            post_key_values(out, '&', args...);
        }
    }

    /*
     * Return the POST request data string for arguments @{args}.
     */
    std::string post_data(const auto&... args)
    {
        std::stringstream post_data;
        post_key_values(post_data, "", args...);
        return post_data.str();
    }


public:
    /*
     * Send a post request to @{url} with arguments @{args...}. The arguments in
     * @{args} should be pairs of field-value pairs. Upon completion, return the
     * response.
     */
    std::string send_post(const std::string& url, const auto&... args)
    {
        auto post_string = post_data(args...);        
        internal_set(CURLOPT_URL, url.c_str());
        internal_set(CURLOPT_COPYPOSTFIELDS, post_string.c_str()),
        internal_set(CURLOPT_WRITEFUNCTION, write_callback);
        internal_set(CURLOPT_WRITEDATA, this);

        response.clear();
        auto r = curl_easy_perform(handle);
        if (r != CURLE_OK) {
            throw std::runtime_error("CURL perform POST failure " + std::to_string(r));
        }

        std::string result(response.begin(), response.end());
        return result;
    }

    /*
     * Send a POST request to @{url} with raw JSON body @{json_body}. Upon
     * completion, return the response.
     */
    std::string post_json_raw(const std::string& url, const std::string& json_body) {
        // Set URL
        internal_set(CURLOPT_URL, url.c_str());

        // Set Pandaproxy headers
        struct curl_slist* headers = nullptr;
        headers = curl_slist_append(headers, "Content-Type: application/vnd.kafka.json.v2+json");
        headers = curl_slist_append(headers, "Accept: application/vnd.kafka.v2+json");
        internal_set(CURLOPT_HTTPHEADER, headers);

        // Ensure POST with exact body bytes
        internal_set(CURLOPT_POST, 1L);
        internal_set(CURLOPT_POSTFIELDS, json_body.c_str());
        internal_set(CURLOPT_POSTFIELDSIZE, (long)json_body.size());

        // Capture response
        internal_set(CURLOPT_WRITEFUNCTION, write_callback);
        internal_set(CURLOPT_WRITEDATA, this);
        response.clear();

        auto r = curl_easy_perform(handle);

        // Clean up headers after perform
        curl_slist_free_all(headers);

        if (r != CURLE_OK) {
            throw std::runtime_error("CURL perform JSON POST failure " + std::to_string(r));
        }
        return std::string(response.begin(), response.end());
    }


};


/*
 * Read and return an unsigned value from @{data}.
 */
unsigned long read_uint(const std::string& data)
{
    std::size_t position = 0;
    auto r = std::stoul(data, &position);
    if (position != data.size()) {
        throw std::runtime_error("invalid character in numeric argument");
    }
    return r;
}


/*
 * Perform the wandlr workload mode.
 */
void workload_mode(int argc, char* argv[])
{
    std::string url = argv[2];

    // argv: [0]=wandlr, [1]=w, [2]=url, [3]=cid, [4]=wait, [5]=rounds
    if (argc != 6) {
        throw std::runtime_error("usage: wandlr w url cid wait rounds");
    }

    std::string client_id = std::to_string(read_uint(argv[3]));
    std::chrono::seconds retry{read_uint(argv[4])};
    std::uint64_t max_rounds = read_uint(argv[5]);

    std::uint64_t rank = 0;
    for (std::uint64_t i = 0; i < max_rounds; ++i) {
        curl_handle handle;
        auto result = handle.send_post(
            url,
            "client_id", client_id,
            "next_rank", std::to_string(rank++)
        );
        std::cout << result << std::endl;

        // sleep between requests
        if (i < max_rounds) {
            std::this_thread::sleep_for(retry);
        }
    }
}


/*
 * Perform the wandlr log redirect mode.
 */

void log_redirect_mode(int argc, char* argv[])
{
    std::string url = argv[2];
    if (argc != 4) {
        throw std::runtime_error("missing receiver id");
    }

    // This is the ID of the node that is LOGGING / RECEIVING the messages
    // std::string receiver_id = std::to_string(read_uint(argv[3]));
    std::string receiver_id = argv[3];  // accept any string, no numeric parse

    std::string line;
    while (true) {
        std::getline(std::cin, line);
        if (!line.empty()) {
            // Build: {"records":[{"value":{"receiver":<receiver_id>,"data":<line>}}]}
            // <line> is already valid JSON from pbft_demo_json
            std::string body;
            body.reserve(line.size() + 64);
            body += R"({"records":[{"value":{"receiver":")";
            body += receiver_id;      // string like "replica-1"
            body += R"(","data":)";
            body += line;
            body += R"(}}]})";

            curl_handle handle;
            auto result = handle.post_json_raw(url, body);
            if (!result.empty()) {
                std::cerr << result << std::endl;
            }
        }
    }
}


/*
 * Main entrypoint.
 */
int main(int argc, char* argv[])
{
    using namespace std::string_view_literals;
    try {
        if (argc < 3) {
            throw std::runtime_error("missing command line arguments");            
        }

        if (argv[1] == "w"sv) {
            workload_mode(argc, argv);
        }
        else if (argv[1] == "lr"sv) {
            log_redirect_mode(argc, argv);
        }
        else {
            throw std::runtime_error("invalid mode");
        }
    }
    catch (const std::exception& ex) {
        std::cerr << "Failure: " << ex.what() << std::endl
                  << helper_message << std::endl;
    }
}