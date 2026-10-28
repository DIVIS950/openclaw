import Foundation

enum BackendStatus: Equatable {
    case connected
    case reconnecting(String)
}

/// One way of talking to the house. The store owns exactly one at a time and
/// swaps it when the connection settings change.
@MainActor
protocol HomeBackend: AnyObject {
    /// Push-style backends call this whenever feedback changes state.
    var onChange: ((HomeSnapshot) -> Void)? { get set }
    /// Push-style backends report dropped/restored connections here.
    var onStatusChange: ((BackendStatus) -> Void)? { get set }
    /// How often the store should poll `fetch()`. nil = the backend pushes changes.
    var pollInterval: Duration? { get }

    func connect() async throws
    func disconnect()
    func fetch() async throws -> HomeSnapshot
    func perform(_ command: HomeCommand) async throws
}

enum BackendError: LocalizedError {
    case notConfigured(String)
    case connection(String)
    case http(Int, String)
    case badResponse(String)
    case notSupported(String)

    var errorDescription: String? {
        switch self {
        case let .notConfigured(message): message
        case let .connection(message): message
        case let .http(status, message): "The system answered \(status): \(message)"
        case let .badResponse(message): message
        case let .notSupported(what): "\(what) isn't supported by this system."
        }
    }
}
