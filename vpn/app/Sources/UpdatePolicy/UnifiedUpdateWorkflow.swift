import Foundation

/// Decision layer for one Update action: application FIRST, subscription SECOND.
/// Call from one serialized owner. Effects require real platform adapters; this
/// type never downloads, authorizes, installs, or modifies a live VPN itself.
public struct UnifiedUpdateWorkflow {
    public enum Phase: Equatable {
        case idle, checkingApplication
        case awaitingApproval(UInt32), savingContinuation(UInt32)
        case installingApplication(UInt32), awaitingRelaunch(UInt32)
        case refreshingSubscription, cancelling, cancellationUnconfirmed
        case completed(SubscriptionResult)
        case stopped(Failure)
    }

    public enum Failure: String, Error, Equatable {
        case invalidBuild, versionNotConfirmed, incompatibleUpdate
        case checkFailed, persistenceFailed, installationFailed
        case cancelled, invalidContinuation, relaunchNotConfirmed
        case subscriptionFailed
    }

    public enum CheckResult: Equatable {
        // Only a successful, signature-validated feed with the same build is
        // positive evidence. "No update found" alone is NOT sufficient.
        case latest(verifiedBuild: UInt32)
        case newer(build: UInt32)
        case incompatible, failed, unknown
    }

    public enum SubscriptionResult: Equatable {
        case updated
        case notApplicable // A manually entered SOCKS5 profile has no feed.
    }

    public struct Continuation: Codable, Equatable {
        public var schema: Int
        public var operation: UUID
        public var bundleID: String
        public var feed: String
        public var fromBuild: UInt32
        public var targetBuild: UInt32
        public var createdAt: Date
    }

    public enum Effect: Equatable {
        case checkApplication(UUID)
        case saveContinuation(Continuation)
        case removeContinuation
        case installApplication(operation: UUID, build: UInt32)
        case refreshSubscription(UUID)
        case cancelPlatformOperations(UUID)
    }

    public private(set) var phase: Phase = .idle
    public private(set) var operation: UUID?
    public let runningBuild: UInt32
    public static let maximumBuild: UInt32 = 2_147_483_647
    public static let continuationLifetime: TimeInterval = 7 * 24 * 60 * 60

    public init(runningBuild: UInt32) throws {
        guard runningBuild > 0, runningBuild <= Self.maximumBuild else {
            throw Failure.invalidBuild
        }
        self.runningBuild = runningBuild
    }

    public var isBusy: Bool {
        switch phase {
        case .idle, .completed, .stopped: return false
        default: return true
        }
    }

    /// Both the toolbar button and menu action must call this same entry point.
    public mutating func begin() -> [Effect] {
        guard !isBusy else { return [] }
        let id = UUID()
        operation = id
        phase = .checkingApplication
        return [.removeContinuation, .checkApplication(id)]
    }

    public mutating func checked(_ result: CheckResult, operation id: UUID) -> [Effect] {
        guard operation == id, phase == .checkingApplication else { return [] }
        switch result {
        case .latest(let verified):
            guard verified == runningBuild else { return stop(.versionNotConfirmed) }
            phase = .refreshingSubscription
            return [.refreshSubscription(id)]
        case .newer(let target):
            guard target > runningBuild, target <= Self.maximumBuild else {
                return stop(.versionNotConfirmed)
            }
            phase = .awaitingApproval(target)
            return []
        case .incompatible: return stop(.incompatibleUpdate)
        case .failed: return stop(.checkFailed)
        case .unknown: return stop(.versionNotConfirmed)
        }
    }

    /// Preserve the user's existing install confirmation, rather than silently
    /// replacing the application. The continuation contains no VPN credentials.
    public mutating func approveInstallation(operation id: UUID, now: Date) -> [Effect] {
        guard operation == id, case .awaitingApproval(let target) = phase else { return [] }
        guard now.timeIntervalSince1970.isFinite else { return stop(.invalidContinuation) }
        let continuation = Continuation(schema: 1, operation: id,
            bundleID: ReleaseConfiguration.bundleID, feed: ReleaseConfiguration.feed,
            fromBuild: runningBuild, targetBuild: target, createdAt: now)
        phase = .savingContinuation(target)
        return [.saveContinuation(continuation)]
    }

    /// Do not install until the continuation has actually been saved atomically.
    public mutating func continuationSaved(operation id: UUID, success: Bool) -> [Effect] {
        guard operation == id, case .savingContinuation(let target) = phase else { return [] }
        guard success else { return stop(.persistenceFailed) }
        phase = .installingApplication(target)
        return [.installApplication(operation: id, build: target)]
    }

    /// A completed download / scheduled restart is NOT an installed new version.
    public mutating func relaunchScheduled(operation id: UUID) -> [Effect] {
        guard operation == id, case .installingApplication(let target) = phase else { return [] }
        phase = .awaitingRelaunch(target)
        return []
    }

    public mutating func installationFailed(operation id: UUID) -> [Effect] {
        guard operation == id else { return [] }
        switch phase {
        case .installingApplication, .awaitingRelaunch: return stop(.installationFailed)
        default: return []
        }
    }

    /// Call once after relaunch with the REAL build from the running app bundle.
    /// A saved marker is only intent, never proof the application is up-to-date.
    public mutating func resume(_ saved: Continuation, now: Date) -> [Effect] {
        guard !isBusy else { return [] }
        let age = now.timeIntervalSince(saved.createdAt)
        guard saved.schema == 1,
              saved.bundleID == ReleaseConfiguration.bundleID,
              saved.feed == ReleaseConfiguration.feed,
              saved.fromBuild > 0, saved.targetBuild > saved.fromBuild,
              saved.targetBuild <= Self.maximumBuild,
              age.isFinite, age >= -300, age <= Self.continuationLifetime else {
            return stop(.invalidContinuation)
        }
        guard runningBuild >= saved.targetBuild else { return stop(.relaunchNotConfirmed) }
        // New token invalidates callbacks belonging to the old app process.
        let id = UUID()
        operation = id
        phase = .checkingApplication
        return [.checkApplication(id)] // Check signed feed again, THEN subscription.
    }

    public mutating func subscriptionFinished(operation id: UUID,
                                               result: SubscriptionResult?) -> [Effect] {
        guard operation == id, phase == .refreshingSubscription else { return [] }
        guard let result = result else { return stop(.subscriptionFailed) }
        phase = .completed(result)
        return [.removeContinuation]
    }

    public mutating func cancel() -> [Effect] {
        guard isBusy, let id = operation else { return [] }
        guard phase != .cancelling else { return [] }
        phase = .cancelling
        // No new cycle until the platform confirms cancellation. Stale results
        // are ignored because this is neither checking nor refreshing phase.
        return [.cancelPlatformOperations(id), .removeContinuation]
    }

    public mutating func cancellationFinished(operation id: UUID, success: Bool) -> [Effect] {
        guard operation == id,
              phase == .cancelling || phase == .cancellationUnconfirmed else { return [] }
        if success {
            operation = nil
            phase = .stopped(.cancelled)
        } else {
            phase = .cancellationUnconfirmed // block overlapping updates
        }
        return []
    }

    private mutating func stop(_ failure: Failure) -> [Effect] {
        phase = .stopped(failure)
        operation = nil
        return [.removeContinuation]
    }
}
