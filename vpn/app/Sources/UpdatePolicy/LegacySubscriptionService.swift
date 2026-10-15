import Foundation

/// Temporary integration with the installed, hash-pinned 2.1.3 runtime.
/// Exactly one fixed action, no command strings from profiles or the renderer.
public final class LegacySubscriptionService {
    public init() {}
    public static func shellQuote(_ text: String) -> String {
        "'" + text.replacingOccurrences(of: "'", with: "'\\''") + "'"
    }
    public static func appleScriptQuote(_ text: String) -> String {
        "\"" + text.replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
            .replacingOccurrences(of: "\n", with: "\\n") + "\""
    }
    public func refresh(completion: @escaping (UnifiedUpdateWorkflow.SubscriptionResult?) -> Void) {
        guard let url = Bundle.main.url(forResource: "refresh_legacy_subscription", withExtension: "py"),
              let payload = try? Data(contentsOf: url), payload.count <= 16384,
              let source = String(data: payload, encoding: .utf8) else { completion(nil); return }
        // Source is passed as a single literal argument, not an executable path
        // in a writable temp directory. Credentials remain in root-only storage.
        let command = "/usr/bin/python -E -s -B -c " + Self.shellQuote(source)
        let script = "do shell script " + Self.appleScriptQuote(command) + " with administrator privileges"
        DispatchQueue.global(qos: .userInitiated).async {
            let process = Process()
            process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
            process.arguments = ["-e", script]
            process.environment = ["PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "LANG": "en_US.UTF-8"]
            process.currentDirectoryURL = URL(fileURLWithPath: "/")
            process.standardInput = FileHandle.nullDevice
            let output = Pipe()
            process.standardOutput = output
            process.standardError = FileHandle.nullDevice // Never echo AppleScript/source or credentials.
            var result: UnifiedUpdateWorkflow.SubscriptionResult?
            do {
                try process.run()
                // Keep the UI responsive; the system's authorization dialogue
                // provides cancellation. The root operation itself uses bounded
                // network calls and the existing command lock.
                let data = output.fileHandleForReading.readDataToEndOfFile()
                process.waitUntilExit()
                result = UpdateEvidence.subscription(code: process.terminationStatus, data: data)
            } catch { result = nil }
            DispatchQueue.main.async { completion(result) }
        }
    }
}
