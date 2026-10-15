import Foundation
import XCTest
@testable import UpdatePolicy

final class UnifiedUpdateWorkflowTests: XCTestCase {
    typealias W = UnifiedUpdateWorkflow
    private let now = Date(timeIntervalSince1970: 1_800_000_000)

    private func started(_ build: UInt32 = 41) throws -> (W, UUID) {
        var w = try W(runningBuild: build)
        let effects = w.begin()
        let id = try XCTUnwrap(w.operation)
        XCTAssertEqual(effects, [.removeContinuation, .checkApplication(id)])
        return (w, id)
    }

    private func checkpoint() throws -> W.Continuation {
        var (w, id) = try started()
        XCTAssertEqual(w.checked(.newer(build: 42), operation: id), [])
        let effects = w.approveInstallation(operation: id, now: now)
        guard case .saveContinuation(let saved) = effects.first else {
            throw NSError(domain: "fixture", code: 1)
        }
        return saved
    }

    private func assertNoSubscription(_ effects: [W.Effect], file: StaticString = #filePath,
                                     line: UInt = #line) {
        XCTAssertFalse(effects.contains { if case .refreshSubscription = $0 { return true }; return false },
                       file: file, line: line)
    }

    func testInitialStateDoesNotStartAnything() throws {
        let w = try W(runningBuild: 1)
        XCTAssertEqual(w.phase, .idle)
        XCTAssertNil(w.operation)
        XCTAssertFalse(w.isBusy)
    }
    func testZeroBuildRejected() { XCTAssertThrowsError(try W(runningBuild: 0)) }
    func testTooLargeBuildRejected() { XCTAssertThrowsError(try W(runningBuild: .max)) }
    func testMaxBuildAccepted() throws { _ = try W(runningBuild: W.maximumBuild) }

    func testClickStartsOnlyVersionCheck() throws {
        let (w, _) = try started()
        XCTAssertEqual(w.phase, .checkingApplication)
        XCTAssertTrue(w.isBusy)
    }
    func testDoubleClickDoesNotStartParallelOperation() throws {
        var (w, id) = try started()
        XCTAssertEqual(w.begin(), [])
        XCTAssertEqual(w.operation, id)
    }
    func testLatestApplicationAllowsSubscription() throws {
        var (w, id) = try started()
        XCTAssertEqual(w.checked(.latest(verifiedBuild: 41), operation: id), [.refreshSubscription(id)])
        XCTAssertEqual(w.phase, .refreshingSubscription)
    }
    func testDifferentBuildIsNotEvidenceOfLatest() throws {
        for build: UInt32 in [0, 1, 40, 42, .max] {
            var (w, id) = try started()
            assertNoSubscription(w.checked(.latest(verifiedBuild: build), operation: id))
            XCTAssertEqual(w.phase, .stopped(.versionNotConfirmed))
        }
    }
    func testCannotSkipFailedVersionCheck() throws {
        var (w, id) = try started()
        assertNoSubscription(w.checked(.failed, operation: id))
        XCTAssertEqual(w.phase, .stopped(.checkFailed))
    }
    func testIncompatibleUpdateDoesNotCountAsCurrent() throws {
        var (w, id) = try started()
        assertNoSubscription(w.checked(.incompatible, operation: id))
        XCTAssertEqual(w.phase, .stopped(.incompatibleUpdate))
    }
    func testUnknownNoUpdateResultDoesNotCountAsCurrent() throws {
        var (w, id) = try started()
        assertNoSubscription(w.checked(.unknown, operation: id))
        XCTAssertEqual(w.phase, .stopped(.versionNotConfirmed))
    }
    func testNewerVersionRequiresApplicationFirst() throws {
        var (w, id) = try started()
        XCTAssertEqual(w.checked(.newer(build: 42), operation: id), [])
        XCTAssertEqual(w.phase, .awaitingApproval(42))
        XCTAssertEqual(w.begin(), [])
    }
    func testDowngradeAndInvalidTargetRejected() throws {
        for target: UInt32 in [0, 40, 41, .max] {
            var (w, id) = try started()
            assertNoSubscription(w.checked(.newer(build: target), operation: id))
            XCTAssertEqual(w.phase, .stopped(.versionNotConfirmed))
        }
    }
    func testUnknownCallbackIgnored() throws {
        var (w, _) = try started()
        XCTAssertEqual(w.checked(.latest(verifiedBuild: 41), operation: UUID()), [])
        XCTAssertEqual(w.phase, .checkingApplication)
    }
    func testDuplicateLatestDoesNotRepeatSubscription() throws {
        var (w, id) = try started()
        _ = w.checked(.latest(verifiedBuild: 41), operation: id)
        XCTAssertEqual(w.checked(.latest(verifiedBuild: 41), operation: id), [])
        XCTAssertEqual(w.begin(), [])
    }
    func testApprovalRequiresDurableCheckpointBeforeInstall() throws {
        var (w, id) = try started()
        _ = w.checked(.newer(build: 42), operation: id)
        let actions = w.approveInstallation(operation: id, now: now)
        XCTAssertEqual(actions.count, 1)
        guard case .saveContinuation(let saved) = actions[0] else { return XCTFail("Expected save") }
        XCTAssertEqual(saved.fromBuild, 41)
        XCTAssertEqual(saved.targetBuild, 42)
        XCTAssertEqual(saved.operation, id)
        XCTAssertEqual(saved.createdAt, now)
        XCTAssertEqual(w.phase, .savingContinuation(42))
        XCTAssertEqual(w.continuationSaved(operation: id, success: true),
                       [.installApplication(operation: id, build: 42)])
        XCTAssertEqual(w.phase, .installingApplication(42))
    }
    func testFailedCheckpointNeverInstallsOrRefreshes() throws {
        var (w, id) = try started()
        _ = w.checked(.newer(build: 42), operation: id)
        _ = w.approveInstallation(operation: id, now: now)
        XCTAssertEqual(w.continuationSaved(operation: id, success: false), [.removeContinuation])
        XCTAssertEqual(w.phase, .stopped(.persistenceFailed))
    }
    func testLateCheckpointCannotInstallWithoutApproval() throws {
        var (w, id) = try started()
        XCTAssertEqual(w.continuationSaved(operation: id, success: true), [])
    }
    func testDownloadingIsNotInstalling() throws {
        var (w, id) = try started()
        _ = w.checked(.newer(build: 42), operation: id)
        _ = w.approveInstallation(operation: id, now: now)
        _ = w.continuationSaved(operation: id, success: true)
        XCTAssertEqual(w.relaunchScheduled(operation: id), [])
        XCTAssertEqual(w.phase, .awaitingRelaunch(42))
        XCTAssertEqual(w.checked(.latest(verifiedBuild: 41), operation: id), [])
        XCTAssertEqual(w.subscriptionFinished(operation: id, result: .updated), [])
    }
    func testInstallFailureStopsSubscription() throws {
        var (w, id) = try started()
        _ = w.checked(.newer(build: 42), operation: id)
        _ = w.approveInstallation(operation: id, now: now)
        _ = w.continuationSaved(operation: id, success: true)
        assertNoSubscription(w.installationFailed(operation: id))
        XCTAssertEqual(w.phase, .stopped(.installationFailed))
    }
    func testCheckpointRoundTripContainsNoCredentials() throws {
        let saved = try checkpoint()
        let bytes = try JSONEncoder().encode(saved)
        XCTAssertEqual(try JSONDecoder().decode(W.Continuation.self, from: bytes), saved)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: bytes) as? [String: Any])
        XCTAssertEqual(Set(object.keys), Set(["schema", "operation", "bundleID", "feed", "fromBuild", "targetBuild", "createdAt"]))
    }
    func testResumeMustRecheckLatestBeforeSubscription() throws {
        let saved = try checkpoint()
        var w = try W(runningBuild: 42)
        let effects = w.resume(saved, now: now.addingTimeInterval(20))
        let id = try XCTUnwrap(w.operation)
        XCTAssertNotEqual(id, saved.operation)
        XCTAssertEqual(effects, [.checkApplication(id)])
        XCTAssertEqual(w.checked(.latest(verifiedBuild: 42), operation: id), [.refreshSubscription(id)])
    }
    func testRestartingOldApplicationDoesNotContinueSubscription() throws {
        var w = try W(runningBuild: 41)
        assertNoSubscription(w.resume(try checkpoint(), now: now))
        XCTAssertEqual(w.phase, .stopped(.relaunchNotConfirmed))
    }
    func testAnotherReleaseFoundAfterRestartMustAlsoInstallFirst() throws {
        var w = try W(runningBuild: 42)
        _ = w.resume(try checkpoint(), now: now)
        let id = try XCTUnwrap(w.operation)
        assertNoSubscription(w.checked(.newer(build: 43), operation: id))
        XCTAssertEqual(w.phase, .awaitingApproval(43))
    }
    func testFreshCheckFailureAfterRestartBlocksSubscription() throws {
        var w = try W(runningBuild: 42)
        _ = w.resume(try checkpoint(), now: now)
        let id = try XCTUnwrap(w.operation)
        assertNoSubscription(w.checked(.failed, operation: id))
        XCTAssertEqual(w.phase, .stopped(.checkFailed))
    }
    func testExpiredCheckpointIsRejected() throws {
        var w = try W(runningBuild: 42)
        _ = w.resume(try checkpoint(), now: now.addingTimeInterval(W.continuationLifetime + 1))
        XCTAssertEqual(w.phase, .stopped(.invalidContinuation))
    }
    func testFutureCheckpointIsRejected() throws {
        var w = try W(runningBuild: 42)
        _ = w.resume(try checkpoint(), now: now.addingTimeInterval(-301))
        XCTAssertEqual(w.phase, .stopped(.invalidContinuation))
    }
    func testWrongIdentityFeedAndSchemaAreRejected() throws {
        let original = try checkpoint()
        var variants = [W.Continuation]()
        var bad = original; bad.schema = 2; variants.append(bad)
        bad = original; bad.bundleID = "org.other"; variants.append(bad)
        bad = original; bad.feed = "https://example.com/untrusted.xml"; variants.append(bad)
        bad = original; bad.targetBuild = bad.fromBuild; variants.append(bad)
        bad = original; bad.fromBuild = 0; variants.append(bad)
        for saved in variants {
            var w = try W(runningBuild: 42)
            _ = w.resume(saved, now: now)
            XCTAssertEqual(w.phase, .stopped(.invalidContinuation))
        }
    }
    func testSubscriptionFailureDoesNotClaimEverythingUpdated() throws {
        var (w, id) = try started()
        _ = w.checked(.latest(verifiedBuild: 41), operation: id)
        XCTAssertEqual(w.subscriptionFinished(operation: id, result: nil), [.removeContinuation])
        XCTAssertEqual(w.phase, .stopped(.subscriptionFailed))
    }
    func testSubscriptionSuccessIsSeparateFromAppSuccess() throws {
        var (w, id) = try started()
        _ = w.checked(.latest(verifiedBuild: 41), operation: id)
        _ = w.subscriptionFinished(operation: id, result: .updated)
        XCTAssertEqual(w.phase, .completed(.updated))
        XCTAssertFalse(w.isBusy)
    }
    func testManualSocksProfileHasExplicitNoSubscriptionResult() throws {
        var (w, id) = try started()
        _ = w.checked(.latest(verifiedBuild: 41), operation: id)
        _ = w.subscriptionFinished(operation: id, result: .notApplicable)
        XCTAssertEqual(w.phase, .completed(.notApplicable))
    }
    func testPrematureSubscriptionCompletionCannotSucceed() throws {
        var (w, id) = try started()
        XCTAssertEqual(w.subscriptionFinished(operation: id, result: .updated), [])
        XCTAssertEqual(w.phase, .checkingApplication)
    }
    func testCancellationWaitsForPlatformAndRejectsLateCheck() throws {
        var (w, id) = try started()
        XCTAssertEqual(w.cancel(), [.cancelPlatformOperations(id), .removeContinuation])
        XCTAssertEqual(w.phase, .cancelling)
        XCTAssertEqual(w.begin(), [])
        XCTAssertEqual(w.checked(.latest(verifiedBuild: 41), operation: id), [])
        _ = w.cancellationFinished(operation: id, success: true)
        XCTAssertEqual(w.phase, .stopped(.cancelled))
        XCTAssertFalse(w.isBusy)
    }
    func testUnconfirmedCancellationBlocksNewOperation() throws {
        var (w, id) = try started()
        _ = w.cancel()
        _ = w.cancellationFinished(operation: id, success: false)
        XCTAssertEqual(w.phase, .cancellationUnconfirmed)
        XCTAssertEqual(w.begin(), [])
    }
    func testOldCallbackAfterNewCycleCannotRefreshSubscription() throws {
        var (w, oldID) = try started()
        _ = w.cancel(); _ = w.cancellationFinished(operation: oldID, success: true)
        _ = w.begin()
        XCTAssertNotEqual(w.operation, oldID)
        XCTAssertEqual(w.checked(.latest(verifiedBuild: 41), operation: oldID), [])
    }
    func testRepeatedClicksAndCompletionStayIdempotent() throws {
        var (w, id) = try started()
        for _ in 0..<100 { XCTAssertEqual(w.begin(), []) }
        _ = w.checked(.latest(verifiedBuild: 41), operation: id)
        _ = w.subscriptionFinished(operation: id, result: .updated)
        XCTAssertEqual(w.subscriptionFinished(operation: id, result: .updated), [])
        XCTAssertEqual(w.phase, .completed(.updated))
    }
}
