import AppKit
import Sparkle

/// Uses Sparkle's real UI, but never replies 'install' until our continuation
/// is saved. Dismiss at the final installation prompt means cancel, not a
/// hidden install-on-quit. No own archive download or signature implementation.
@MainActor
final class GatedUpdateDriver: NSObject, SPUUserDriver {
    private let standard = SPUStandardUserDriver(hostBundle: .main, delegate: nil)
    var approve: ((SUAppcastItem) -> Bool)?
    var ready: (() -> Bool)?
    var cancelled: (() -> Void)?
    var installing: (() -> Void)?

    func show(_ request: SPUUpdatePermissionRequest, reply: @escaping (SUUpdatePermissionResponse) -> Void) {
        standard.show(request, reply: reply)
    }
    func showUserInitiatedUpdateCheck(cancellation: @escaping () -> Void) {
        standard.showUserInitiatedUpdateCheck { [weak self] in self?.cancelled?(); cancellation() }
    }
    func showUpdateFound(with item: SUAppcastItem, state: SPUUserUpdateState,
                         reply: @escaping (SPUUserUpdateChoice) -> Void) {
        standard.showUpdateFound(with: item, state: state) { [weak self] choice in
            guard let self = self else { reply(.skip); return }
            if choice == .install {
                guard !item.isInformationOnlyUpdate, self.approve?(item) == true else {
                    self.cancelled?(); reply(.skip); return
                }
                reply(.install)
            } else {
                self.cancelled?()
                reply(state.stage == .installing ? .skip : choice)
            }
        }
    }
    func showUpdateReleaseNotes(with data: SPUDownloadData) { standard.showUpdateReleaseNotes(with: data) }
    func showUpdateReleaseNotesFailedToDownloadWithError(_ error: Error) {
        standard.showUpdateReleaseNotesFailedToDownloadWithError(error)
    }
    func showUpdateNotFoundWithError(_ error: Error, acknowledgement: @escaping () -> Void) {
        standard.showUpdateNotFoundWithError(error, acknowledgement: acknowledgement)
    }
    func showUpdaterError(_ error: Error, acknowledgement: @escaping () -> Void) {
        standard.showUpdaterError(error, acknowledgement: acknowledgement)
    }
    func showDownloadInitiated(cancellation: @escaping () -> Void) {
        standard.showDownloadInitiated { [weak self] in self?.cancelled?(); cancellation() }
    }
    func showDownloadDidReceiveExpectedContentLength(_ length: UInt64) {
        standard.showDownloadDidReceiveExpectedContentLength(length)
    }
    func showDownloadDidReceiveData(ofLength length: UInt64) { standard.showDownloadDidReceiveData(ofLength: length) }
    func showDownloadDidStartExtractingUpdate() { standard.showDownloadDidStartExtractingUpdate() }
    func showExtractionReceivedProgress(_ progress: Double) { standard.showExtractionReceivedProgress(progress) }
    func showReadyToInstallAndRelaunch(_ reply: @escaping (SPUUserUpdateChoice) -> Void) {
        standard.showReadyToInstallAndRelaunch { [weak self] choice in
            guard let self = self, choice == .install, self.ready?() == true else {
                self?.cancelled?(); reply(.skip); return
            }
            reply(.install)
        }
    }
    func showInstallingUpdate(withApplicationTerminated terminated: Bool,
                              retryTerminatingApplication retry: @escaping () -> Void) {
        installing?()
        standard.showInstallingUpdate(withApplicationTerminated: terminated, retryTerminatingApplication: retry)
    }
    func showUpdateInstalledAndRelaunched(_ relaunched: Bool, acknowledgement: @escaping () -> Void) {
        // The old process cannot prove which build is now running. Resume is
        // performed by the new process using its own bundle and a fresh feed.
        standard.showUpdateInstalledAndRelaunched(relaunched, acknowledgement: acknowledgement)
    }
    func dismissUpdateInstallation() { standard.dismissUpdateInstallation() }
}
