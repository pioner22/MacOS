import Foundation

/// Fail closed before starting Sparkle if a build has no trusted update channel.
/// This validates packaging configuration; Sparkle validates the actual signatures.
public struct ReleaseConfiguration: Equatable {
    public static let bundleID = "ru.pioner22.BigSurVPN"
    public static let feed = "https://raw.githubusercontent.com/pioner22/MacOS/main/vpn-app/updates/appcast.xml"
    public let version: String
    public let build: UInt32
    public let publicKey: String

    public enum Failure: String, Error, LocalizedError {
        case development = "Это тестовая сборка. Канал подписанных обновлений ещё не включён."
        case identity = "Идентификатор приложения не соответствует каналу обновлений."
        case version = "Некорректный номер версии или сборки приложения."
        case feed = "Не задан разрешённый HTTPS-адрес обновлений."
        case key = "Не настроен публичный ключ подписи обновлений."
        case security = "Защитные настройки обновлений неполны."
        case manual = "Обновления этой сборки должны устанавливаться только с подтверждением."
        public var errorDescription: String? { rawValue }
    }

    public init(info: [String: Any]) throws {
        guard info["VPNReleaseBuild"] as? Bool == true else { throw Failure.development }
        guard info["CFBundleIdentifier"] as? String == Self.bundleID else { throw Failure.identity }
        guard let version = info["CFBundleShortVersionString"] as? String,
              version.range(of: #"\A(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\z"#,
                            options: .regularExpression) != nil,
              let number = info["CFBundleVersion"] as? String,
              number.range(of: #"\A[1-9][0-9]{0,9}\z"#, options: .regularExpression) != nil,
              let build = UInt32(number), build <= 2_147_483_647 else { throw Failure.version }
        guard info["SUFeedURL"] as? String == Self.feed else { throw Failure.feed }
        guard let key = info["SUPublicEDKey"] as? String,
              let bytes = Data(base64Encoded: key), bytes.count == 32,
              bytes.base64EncodedString() == key,
              Set(bytes).count > 1 else { throw Failure.key }
        guard info["SUVerifyUpdateBeforeExtraction"] as? Bool == true,
              info["SURequireSignedFeed"] as? Bool == true,
              info["SUSignedFeedFailureExpirationInterval"] as? Int == 0,
              info["SUEnableJavaScript"] as? Bool == false,
              info["SUEnableSystemProfiling"] as? Bool == false else { throw Failure.security }
        guard info["SUEnableAutomaticChecks"] as? Bool == false,
              info["SUAutomaticallyUpdate"] as? Bool == false,
              info["SUAllowsAutomaticUpdates"] as? Bool == false else { throw Failure.manual }
        self.version = version
        self.build = build
        self.publicKey = key
    }
}

/// Shared policy for the future VPN controller: checking does not change a tunnel.
/// A service update is deliberately not an application-bundle update.
public enum VPNActivity: CaseIterable {
    case idle, connecting, connected, disconnecting, applyingServiceUpdate
    public var allowsApplicationUpdate: Bool {
        switch self {
        case .idle, .connected: return true
        case .connecting, .disconnecting, .applyingServiceUpdate: return false
        }
    }
}
