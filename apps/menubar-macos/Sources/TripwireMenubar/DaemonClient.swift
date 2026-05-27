import Foundation

actor DaemonClient {
    let baseURL: URL
    let session: URLSession

    init(baseURL: URL) {
        self.baseURL = baseURL
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 3
        config.timeoutIntervalForResource = 5
        config.urlCache = nil
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        self.session = URLSession(configuration: config)
    }

    func fetchSummary() async throws -> Summary {
        let url = baseURL.appendingPathComponent("api/summary")
        let (data, response) = try await session.data(from: url)
        guard let http = response as? HTTPURLResponse else {
            throw DaemonError.badResponse(status: nil)
        }
        guard http.statusCode == 200 else {
            throw DaemonError.badResponse(status: http.statusCode)
        }
        return try Self.decoder.decode(Summary.self, from: data)
    }

    func clearSnoozes() async throws {
        let url = baseURL.appendingPathComponent("api/snoozes")
        var req = URLRequest(url: url)
        req.httpMethod = "DELETE"
        let (_, response) = try await session.data(for: req)
        guard let http = response as? HTTPURLResponse, http.statusCode < 400 else {
            throw DaemonError.badResponse(status: (response as? HTTPURLResponse)?.statusCode)
        }
    }

    private static let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        return d
    }()
}

enum DaemonError: Error {
    case badResponse(status: Int?)
}
