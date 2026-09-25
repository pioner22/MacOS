import AppKit
import Combine
import Sparkle
import UpdatePolicy

/// Single updater instance shared by the window and menu. Never runs as root,
/// invokes shell commands, writes the legacy VPN configuration, or stops launchd.
@MainActor
final class UpdateCenter: NSObject, ObservableObject, SPUUpdaterDelegate {
    @Published private(set) var canCheck = false
    @Published private(set) var configurationProblem: String?
    @Published private(set) var requestedAt: Date?
    @Published var activity: VPNActivity = .idle
    private var controller: SPUStandardUpdaterController?
    private var availability: AnyCancellable?
    private var configuration: ReleaseConfiguration?

    var buttonEnabled: Bool { canCheck && activity.allowsApplicationUpdate }

    override init() {
        super.init()
        guard geteuid() != 0 else {
            configurationProblem = "Приложение нельзя запускать от root. Открой его обычным пользователем."
            return
        }
        do {
            configuration = try ReleaseConfiguration(info: Bundle.main.infoDictionary ?? [:])
        } catch {
            configurationProblem = error.localizedDescription
            return
        }
        let updater = SPUStandardUpdaterController(
            startingUpdater: false, updaterDelegate: self, userDriverDelegate: nil
        )
        controller = updater
        availability = updater.updater.publisher(for: \.canCheckForUpdates)
            .receive(on: RunLoop.main)
            .sink { [weak self] value in self?.canCheck = value }
        updater.startUpdater()
    }

    func checkForUpdates() {
        guard buttonEnabled else { return }
        requestedAt = Date()
        controller?.checkForUpdates(nil)
    }

    // Keep the shipped feed authoritative; never read a URL from a VPN profile.
    func feedURLString(for updater: SPUUpdater) -> String? {
        configuration == nil ? nil : ReleaseConfiguration.feed
    }

    // No pre-release channel is enabled implicitly.
    func allowedChannels(for updater: SPUUpdater) -> Set<String> { [] }
}
