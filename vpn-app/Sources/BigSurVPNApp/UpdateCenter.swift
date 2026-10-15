import AppKit
import Combine
import Sparkle
import UpdatePolicy

/// One button and one transaction: verified app version, THEN subscription.
/// No installed VPN binary, configuration or connection is replaced by Sparkle.
@MainActor
final class UpdateCenter: NSObject, ObservableObject, SPUUpdaterDelegate {
    @Published private(set) var canCheck = false
    @Published private(set) var configurationProblem: String?
    @Published private(set) var requestedAt: Date?
    @Published private(set) var statusText = "Сначала проверяется приложение, затем обновляется подписка."
    @Published private(set) var busy = false
    @Published var activity: VPNActivity = .idle
    private var updater: SPUUpdater?
    private var driver: GatedUpdateDriver?
    private var availability: AnyCancellable?
    private var configuration: ReleaseConfiguration?
    private var workflow: UnifiedUpdateWorkflow?
    private var store: UpdateContinuationStore?
    private let subscriptions = LegacySubscriptionService()
    private var cycleID: UUID?
    private var latestEvidence: UnifiedUpdateWorkflow.CheckResult?
    private var noUpdateError: NSError?
    private var resumeAttempted = false
    private var updaterStarted = false

    var buttonEnabled: Bool { canCheck && !busy && configurationProblem == nil && activity.allowsApplicationUpdate }

    override init() {
        super.init()
        guard geteuid() != 0 else {
            configurationProblem = "Приложение нельзя запускать от root."; return
        }
        do {
            configuration = try ReleaseConfiguration(info: Bundle.main.infoDictionary ?? [:])
            guard let text = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String,
                  let build = UpdateEvidence.build(text) else { throw UnifiedUpdateWorkflow.Failure.invalidBuild }
            workflow = try UnifiedUpdateWorkflow(runningBuild: build)
            let parent = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                                     appropriateFor: nil, create: true)
            store = try UpdateContinuationStore(directoryURL: parent.appendingPathComponent(ReleaseConfiguration.bundleID))
            let ui = GatedUpdateDriver()
            ui.approve = { [weak self] item in self?.approve(item) ?? false }
            ui.ready = { [weak self] in self?.readyToInstall() ?? false }
            ui.cancelled = { [weak self] in self?.userCancelled() }
            ui.installing = { [weak self] in self?.willRelaunch() }
            driver = ui
            let engine = SPUUpdater(hostBundle: .main, applicationBundle: .main, userDriver: ui, delegate: self)
            updater = engine
            availability = engine.publisher(for: \.canCheckForUpdates)
                .receive(on: RunLoop.main)
                .sink { [weak self] value in
                    self?.canCheck = value
                    if value, self?.updaterStarted == true { self?.resumeOnce() }
                }
            try engine.start()
            updaterStarted = true
            DispatchQueue.main.async { [weak self] in
                if self?.canCheck == true { self?.resumeOnce() }
            }
        } catch {
            configurationProblem = "Канал обновлений или локальное хранилище не готово: " + error.localizedDescription
        }
    }

    func checkForUpdates() {
        guard buttonEnabled, let store = store else { return }
        do { try store.acquireLock() }
        catch { statusText = "Обновление уже выполняется в другом окне или процессе."; return }
        requestedAt = Date()
        execute(workflow?.begin() ?? [])
    }

    private func resumeOnce() {
        guard !resumeAttempted, workflow != nil, let store = store else { return }
        resumeAttempted = true
        do {
            try store.acquireLock()
            guard let saved = try store.load() else { store.releaseLock(); return }
            requestedAt = Date()
            execute(workflow?.resume(saved, now: Date()) ?? [])
        } catch {
            statusText = "Продолжение обновления не прочитано; подписка не изменена."
            store.releaseLock()
        }
    }

    private func execute(_ effects: [UnifiedUpdateWorkflow.Effect]) {
        for effect in effects {
            switch effect {
            case .removeContinuation:
                do { try store?.remove() }
                catch {
                    configurationProblem = "Не удалось очистить задание обновления. Подписка не изменена."
                    busy = true; return // fail closed; do not start the following effect
                }
            case .checkApplication(let id):
                cycleID = id; latestEvidence = nil; noUpdateError = nil
                updater?.checkForUpdates()
            case .saveContinuation(let saved):
                do {
                    guard let store = store else { throw UpdateStorageError.io }
                    try store.save(saved)
                    execute(workflow?.continuationSaved(operation: saved.operation, success: true) ?? [])
                } catch {
                    execute(workflow?.continuationSaved(operation: saved.operation, success: false) ?? [])
                }
            case .installApplication:
                // The GatedUpdateDriver is synchronously waiting for approve().
                // It alone gives Sparkle the user's 'install' reply after save.
                break
            case .refreshSubscription(let id):
                subscriptions.refresh { [weak self] result in
                    guard let self = self else { return }
                    self.execute(self.workflow?.subscriptionFinished(operation: id, result: result) ?? [])
                }
            case .cancelPlatformOperations:
                // Triggered by a real Sparkle cancellation/skip reply. Completion
                // is acknowledged by didFinishUpdateCycle, never fabricated here.
                break
            }
        }
        updatePresentation()
    }

    private func approve(_ item: SUAppcastItem) -> Bool {
        guard let id = cycleID, item.signingValidationStatus == .succeeded,
              let target = UpdateEvidence.build(item.versionString),
              workflow?.phase == .awaitingApproval(target), activity.allowsApplicationUpdate else { return false }
        execute(workflow?.approveInstallation(operation: id, now: Date()) ?? [])
        return workflow?.phase == .installingApplication(target) && configurationProblem == nil
    }

    private func readyToInstall() -> Bool {
        guard let flow = workflow, let id = cycleID,
              case .installingApplication(let target) = flow.phase,
              activity.allowsApplicationUpdate, configurationProblem == nil else { return false }
        do {
            guard let saved = try store?.load(), saved.operation == id, saved.targetBuild == target else { return false }
            try store?.save(saved) // verify durable continuation before the final reply
            return true
        } catch { return false }
    }

    private func userCancelled() { execute(workflow?.cancel() ?? []) }
    private func willRelaunch() {
        guard let id = cycleID else { return }
        execute(workflow?.relaunchScheduled(operation: id) ?? [])
    }

    func updater(_ updater: SPUUpdater, mayPerform updateCheck: SPUUpdateCheck) throws {
        guard cycleID != nil, activity.allowsApplicationUpdate, configurationProblem == nil else {
            throw NSError(domain: "BigSurVPN.Update", code: 1,
                          userInfo: [NSLocalizedDescriptionKey: "Обновление не разрешено в текущем состоянии."])
        }
    }

    func updater(_ updater: SPUUpdater, shouldProceedWithUpdate item: SUAppcastItem,
                 updateCheck: SPUUpdateCheck) throws {
        guard cycleID != nil, item.signingValidationStatus == .succeeded,
              item.channel == nil || item.channel == "", !item.isInformationOnlyUpdate,
              UpdateEvidence.build(item.versionString) != nil,
              let url = item.fileURL, url.scheme == "https", url.host == "github.com",
              url.user == nil, url.password == nil, url.fragment == nil,
              url.path.hasPrefix("/pioner22/MacOS/releases/download/vpn-app-v") else {
            throw NSError(domain: "BigSurVPN.Update", code: 2,
                          userInfo: [NSLocalizedDescriptionKey: "Подпись или источник обновления не подтверждены."])
        }
    }

    func feedURLString(for updater: SPUUpdater) -> String? { ReleaseConfiguration.feed }
    func allowedChannels(for updater: SPUUpdater) -> Set<String> { [] }

    func updater(_ updater: SPUUpdater, didFindValidUpdate item: SUAppcastItem) {
        guard let id = cycleID else { return }
        let build = UpdateEvidence.build(item.versionString)
        let stable = item.channel == nil || item.channel == ""
        let result: UnifiedUpdateWorkflow.CheckResult =
            item.signingValidationStatus == .succeeded && stable && !item.isInformationOnlyUpdate && build != nil
            ? .newer(build: build!) : .unknown
        execute(workflow?.checked(result, operation: id) ?? [])
    }

    func updaterDidNotFindUpdate(_ updater: SPUUpdater, error: Error) {
        guard cycleID != nil, let flow = workflow, flow.phase == .checkingApplication else { return }
        let e = error as NSError
        let item = e.userInfo[SPULatestAppcastItemFoundKey] as? SUAppcastItem
        let reason = (e.userInfo[SPUNoUpdateFoundReasonKey] as? NSNumber)?.intValue
        noUpdateError = e
        latestEvidence = UpdateEvidence.latest(running: flow.runningBuild, itemBuild: item?.versionString,
            signatureValid: item?.signingValidationStatus == .succeeded,
            onLatestVersion: reason == Int(SPUNoUpdateFoundReason.onLatestVersion.rawValue),
            stableChannel: item != nil && (item?.channel == nil || item?.channel == ""))
        // Wait for Sparkle's UI cycle to finish before opening authorization UI.
    }

    func updater(_ updater: SPUUpdater, didFinishUpdateCycleFor updateCheck: SPUUpdateCheck, error: Error?) {
        guard let id = cycleID else { return }
        cycleID = nil
        let e = error as NSError?
        let expectedNoUpdate = e == nil || (e?.domain == noUpdateError?.domain && e?.code == noUpdateError?.code)
        if workflow?.phase == .cancelling {
            execute(workflow?.cancellationFinished(operation: id, success: true) ?? [])
        } else if workflow?.phase == .checkingApplication {
            execute(workflow?.checked(expectedNoUpdate ? (latestEvidence ?? .unknown) : .failed, operation: id) ?? [])
        } else if error != nil {
            execute(workflow?.installationFailed(operation: id) ?? [])
        } else if case .awaitingApproval = workflow?.phase {
            execute(workflow?.cancel() ?? [])
            execute(workflow?.cancellationFinished(operation: id, success: true) ?? [])
        }
        latestEvidence = nil; noUpdateError = nil
    }

    func updaterWillRelaunchApplication(_ updater: SPUUpdater) { willRelaunch() }

    private func updatePresentation() {
        guard let flow = workflow else { return }
        busy = flow.isBusy || cycleID != nil
        switch flow.phase {
        case .idle: break
        case .checkingApplication: statusText = "1/2 — проверка актуальности приложения…"
        case .awaitingApproval: statusText = "Новая версия найдена. Подтверди установку в окне обновления."
        case .savingContinuation: statusText = "Сохраняется задание продолжить обновление подписки…"
        case .installingApplication: statusText = "1/2 — загрузка и установка приложения. Подписка пока не изменяется."
        case .awaitingRelaunch: statusText = "После перезапуска новая версия повторит проверку и обновит подписку."
        case .refreshingSubscription: statusText = "2/2 — приложение актуально; обновление подписки…"
        case .completed(.updated): statusText = "Приложение актуально. Подписка обновлена."
        case .completed(.notApplicable): statusText = "Приложение актуально. Для SOCKS5 подписка не требуется."
        case .cancelling, .cancellationUnconfirmed: statusText = "Ожидание подтверждения отмены…"
        case .stopped(.subscriptionFailed): statusText = "Приложение актуально, но подписку обновить не удалось. Старые профили сохранены."
        case .stopped(.cancelled): statusText = "Обновление отменено. Подписка не изменена."
        case .stopped: statusText = "Обновление приложения не подтверждено. Подписка не изменена."
        }
        if !busy { store?.releaseLock() }
    }
}
