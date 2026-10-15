import AppKit
import SwiftUI

@main
@MainActor
struct BigSurVPNApp: App {
    @StateObject private var updates = UpdateCenter()

    var body: some Scene {
        WindowGroup("BigSurVPN") {
            UpdatesView(updates: updates)
                .frame(minWidth: 640, minHeight: 440)
                .onAppear {
                    DevelopmentSmokeCheck.finishIfRequested(updates: updates)
                }
        }
        .commands {
            CommandGroup(after: .appInfo) {
                // Separate observed view also works around pre-Monterey menu refresh.
                CheckForUpdatesMenu(updates: updates)
            }
        }
    }
}

@MainActor
private struct CheckForUpdatesMenu: View {
    @ObservedObject var updates: UpdateCenter
    var body: some View {
        Button("Обновить приложение и подписку…", action: updates.checkForUpdates)
            .disabled(!updates.buttonEnabled)
    }
}

@MainActor
private struct UpdatesView: View {
    @ObservedObject var updates: UpdateCenter
    private var version: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "—"
    }
    private var build: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "—"
    }

    var body: some View {
        HStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 22) {
                Label("BigSurVPN", systemImage: "network")
                    .font(.headline)
                Divider()
                Label("Обновления", systemImage: "arrow.triangle.2.circlepath")
                    .font(.subheadline)
                Spacer()
                Text("macOS 11+ · Intel")
                    .font(.caption).foregroundColor(.secondary)
            }
            .padding(24).frame(width: 170)
            .background(Color(NSColor.controlBackgroundColor))
            Divider()
            VStack(alignment: .leading, spacing: 18) {
                Text("Обновления").font(.largeTitle).bold()
                Text("Приложение \(version) · сборка \(build)")
                    .foregroundColor(.secondary)
                Divider()
                Text("Новые версии и исправления — по одной кнопке.")
                    .font(.headline)
                Text("Сначала проверяется и при необходимости обновляется приложение. Только в актуальной версии обновляется подписка. После перезапуска процесс продолжится автоматически.")
                    .fixedSize(horizontal: false, vertical: true)
                if let problem = updates.configurationProblem {
                    Label(problem, systemImage: "exclamationmark.triangle")
                        .foregroundColor(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Button(action: updates.checkForUpdates) {
                    Label("Обновить", systemImage: "arrow.clockwise")
                        .padding(.horizontal, 8).padding(.vertical, 4)
                }
                .disabled(!updates.buttonEnabled)
                Text(updates.statusText)
                    .fixedSize(horizontal: false, vertical: true)
                if updates.busy { ProgressView().scaleEffect(0.8) }
                if let date = updates.requestedAt {
                    Text("Последний запрос: \(date, style: .date), \(date, style: .time)")
                        .font(.caption).foregroundColor(.secondary)
                }
                Spacer(minLength: 0)
                Divider()
                Text("Подписка обновляется через установленную совместимую службу BigSurVPN 2.1.3. Для SOCKS5 она не требуется. Переключение и переустановка туннеля этой кнопкой не выполняются.")
                    .font(.caption).foregroundColor(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(28).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }
}

/// Development-only native UI readiness probe; never touches a VPN profile.
@MainActor
private enum DevelopmentSmokeCheck {
    private static var finished = false
    static func finishIfRequested(updates: UpdateCenter) {
        guard ProcessInfo.processInfo.environment["BIGSURVPN_SMOKE_TEST"] == "1", !finished else { return }
        finished = true
        guard geteuid() != 0,
              Bundle.main.object(forInfoDictionaryKey: "VPNReleaseBuild") as? Bool == false,
              updates.configurationProblem != nil, !updates.buttonEnabled else {
            FileHandle.standardError.write(Data("BIGSURVPN_NATIVE_SMOKE_FAILED\n".utf8)); exit(1)
        }
        FileHandle.standardOutput.write(Data("BIGSURVPN_NATIVE_UI_READY_UPDATER_DISABLED\n".utf8))
        DispatchQueue.main.async { NSApplication.shared.terminate(nil) }
    }
}
