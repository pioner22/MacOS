import XCTest
@testable import ConnectionPolicy

final class FailoverPolicyTests: XCTestCase {
    typealias P = FailoverPolicy
    typealias T = P.Ticket

    func probe(_ effects: [P.Effect], file: StaticString = #filePath,
               line: UInt = #line) throws -> T {
        let values = effects.compactMap { effect -> T? in
            if case .probe(let t, _) = effect { return t }; return nil
        }
        XCTAssertEqual(values.count, 1, file: file, line: line)
        return try XCTUnwrap(values.first, file: file, line: line)
    }

    func activation(_ effects: [P.Effect]) throws -> T {
        try XCTUnwrap(effects.compactMap { effect -> T? in
            if case .activate(let t) = effect { return t }; return nil
        }.first)
    }

    func disconnection(_ effects: [P.Effect]) throws -> T {
        try XCTUnwrap(effects.compactMap { effect -> T? in
            if case .disconnect(let t) = effect { return t }; return nil
        }.first)
    }

    func running(_ ids: [String] = ["A", "B", "C"],
                 existing: String? = "A") throws -> (P, T) {
        var p = P()
        let first = try probe(p.start(servers: ids, existingServerID: existing, now: 0))
        return (p, first)
    }

    func testDefaultsAreTwoSecondsTenFailures() {
        XCTAssertEqual(P.interval, 2)
        XCTAssertEqual(P.probeTimeout, 2)
        XCTAssertEqual(P.failuresBeforeSwitch, 10)
    }

    func testStartsStoppedAndDoesNothing() throws {
        var p = P()
        XCTAssertEqual(p.phase, .stopped)
        XCTAssertNil(p.activeServerID)
        XCTAssertEqual(try p.tick(now: 100), [])
        XCTAssertEqual(try p.stop(now: 100), [])
    }

    func testEmptyListRejectedWithoutEffects() {
        var p = P()
        XCTAssertThrowsError(try p.start(servers: [], now: 0))
        XCTAssertEqual(p.phase, .stopped)
    }

    func testDuplicatesRejected() {
        var p = P()
        XCTAssertThrowsError(try p.start(servers: ["A", "A"], now: 0))
    }

    func testInvalidIDsRejected() {
        for id in ["", "a\nb", "a\u{0000}b", String(repeating: "a", count: 257)] {
            var p = P()
            XCTAssertThrowsError(try p.start(servers: [id], now: 0))
            XCTAssertEqual(p.phase, .stopped)
        }
    }

    func testUnknownExistingServerRejected() {
        var p = P()
        XCTAssertThrowsError(try p.start(servers: ["A"], existingServerID: "B", now: 0))
    }

    func testIDsAtLengthBoundaryAccepted() throws {
        var p = P()
        let id = String(repeating: "a", count: 256)
        let t = try probe(p.start(servers: [id], now: 0))
        XCTAssertEqual(t.serverID, id)
    }

    func testInitialExistingServerIsSelectedNotFirst() throws {
        let (p, first) = try running(existing: "B")
        XCTAssertEqual(p.selectedServerID, "B")
        XCTAssertEqual(first.serverID, "B")
        XCTAssertEqual(p.activeServerID, "B")
        XCTAssertEqual(p.phase, .checking) // not trusted without a live result
    }

    func testExistingServerUsesActiveTunnelScope() throws {
        var p = P()
        let effects = try p.start(servers: ["A"], existingServerID: "A", now: 0)
        let t = try probe(effects)
        XCTAssertEqual(effects, [.probe(t, .activeTunnel)])
    }

    func testNewServerUsesIsolatedCandidateScope() throws {
        var p = P()
        let effects = try p.start(servers: ["A"], now: 0)
        let t = try probe(effects)
        XCTAssertEqual(effects, [.probe(t, .candidate)])
        XCTAssertNil(p.activeServerID)
    }

    func testNoOverlappingProbeAndTickDoesNotShiftDeadline() throws {
        var (p, first) = try running()
        for now in [0.0, 0.01, 0.5, 1.99] {
            XCTAssertEqual(try p.tick(now: now), [])
        }
        let effects = try p.tick(now: 2)
        XCTAssertEqual(effects.first, .cancel(first))
        let second = try probe(effects)
        XCTAssertEqual(second.deadline, 4)
        XCTAssertNotEqual(first.id, second.id)
        XCTAssertEqual(p.consecutiveFailures, 1)
    }

    func testNineFailedProbesDoNotSwitch() throws {
        var (p, t) = try running()
        for n in 0..<9 {
            if n > 0 { t = try probe(p.tick(now: Double(n * 2))) }
            XCTAssertEqual(try p.probeCompleted(t, reachable: false, now: Double(n * 2) + 0.1), [])
            XCTAssertEqual(p.selectedServerID, "A")
            XCTAssertEqual(p.consecutiveFailures, n + 1)
        }
    }

    func testTenthFailureSelectsNextAndResetsCounter() throws {
        var (p, t) = try running()
        for n in 0..<10 {
            if n > 0 { t = try probe(p.tick(now: Double(n * 2))) }
            let effects = try p.probeCompleted(t, reachable: false, now: Double(n * 2) + 0.1)
            if n == 9 { XCTAssertEqual(effects, [.unavailable("A")]) }
        }
        XCTAssertEqual(p.selectedServerID, "B")
        XCTAssertEqual(p.activeServerID, "A") // not relabeled before actual switch
        XCTAssertEqual(p.consecutiveFailures, 0)
        XCTAssertEqual(try p.tick(now: 19.99), [])
        let effects = try p.tick(now: 20)
        let second = try probe(effects)
        XCTAssertEqual(effects, [.probe(second, .candidate)])
        XCTAssertEqual(second.serverID, "B")
    }

    func testTenMissingRepliesSwitchAtTwentySeconds() throws {
        var (p, _) = try running()
        for n in 1...9 {
            _ = try probe(p.tick(now: Double(n * 2)))
            XCTAssertEqual(p.selectedServerID, "A")
        }
        let effects = try p.tick(now: 20)
        XCTAssertTrue(effects.contains(.unavailable("A")))
        XCTAssertEqual(try probe(effects).serverID, "B")
    }

    func testSuccessfulProbeResetsConsecutiveFailures() throws {
        var (p, t) = try running()
        for n in 0..<9 {
            if n > 0 { t = try probe(p.tick(now: Double(n * 2))) }
            _ = try p.probeCompleted(t, reachable: false, now: Double(n * 2) + 0.1)
        }
        t = try probe(p.tick(now: 18))
        XCTAssertEqual(try p.probeCompleted(t, reachable: true, now: 18.1), [])
        XCTAssertEqual(p.consecutiveFailures, 0)
        XCTAssertEqual(p.phase, .connected)
        t = try probe(p.tick(now: 20))
        _ = try p.probeCompleted(t, reachable: false, now: 20.1)
        XCTAssertEqual(p.selectedServerID, "A")
        XCTAssertEqual(p.consecutiveFailures, 1)
    }

    func testHealthyActiveServerIsNotReactivated() throws {
        var (p, t) = try running()
        for n in 0..<100 {
            if n > 0 { t = try probe(p.tick(now: Double(n * 2))) }
            XCTAssertEqual(try p.probeCompleted(t, reachable: true, now: Double(n * 2) + 0.1), [])
            XCTAssertEqual(p.phase, .connected)
            XCTAssertEqual(p.selectedServerID, "A")
        }
    }

    func testProbeCadenceMeasuredFromStartNotResponse() throws {
        var (p, t) = try running()
        _ = try p.probeCompleted(t, reachable: true, now: 1.8)
        XCTAssertEqual(try p.tick(now: 1.999), [])
        XCTAssertEqual(try probe(p.tick(now: 2)).deadline, 4)
    }

    func testLateReplyAtDeadlineDoesNotReviveServer() throws {
        var (p, t) = try running()
        let effects = try p.probeCompleted(t, reachable: true, now: 2)
        XCTAssertEqual(effects.first, .cancel(t))
        XCTAssertEqual(p.consecutiveFailures, 1)
        XCTAssertEqual(p.phase, .checking)
    }

    func testDuplicateReplyCannotCountTwice() throws {
        var (p, t) = try running()
        _ = try p.probeCompleted(t, reachable: false, now: 0.1)
        XCTAssertEqual(try p.probeCompleted(t, reachable: false, now: 0.2), [])
        XCTAssertEqual(p.consecutiveFailures, 1)
    }

    func testTimedOutOldReplyCannotCompleteCurrentProbe() throws {
        var (p, old) = try running()
        let fresh = try probe(p.tick(now: 2))
        XCTAssertEqual(try p.probeCompleted(old, reachable: true, now: 2.1), [])
        XCTAssertEqual(p.consecutiveFailures, 1)
        _ = try p.probeCompleted(fresh, reachable: true, now: 2.2)
        XCTAssertEqual(p.phase, .connected)
    }

    func testMissedTimerDoesNotInventMultipleLostProbes() throws {
        var (p, _) = try running()
        let t = try probe(p.tick(now: 3600))
        XCTAssertEqual(p.consecutiveFailures, 1)
        XCTAssertEqual(p.selectedServerID, "A")
        XCTAssertEqual(t.deadline, 3602)
        XCTAssertEqual(try p.tick(now: 3600), [])
    }

    func testAllServersUnreachableCycleWithoutGlobalStopLimit() throws {
        var (p, t) = try running(existing: nil)
        let ids = ["A", "B", "C"]
        for n in 0..<3000 { // 100 full cycles, still trying; no real time/network
            if n > 0 { t = try probe(p.tick(now: Double(n * 2))) }
            XCTAssertEqual(t.serverID, ids[(n / 10) % 3])
            _ = try p.probeCompleted(t, reachable: false, now: Double(n * 2) + 0.1)
        }
        XCTAssertEqual(p.selectedServerID, "A")
        XCTAssertEqual(p.phase, .checking)
        XCTAssertEqual(p.consecutiveFailures, 0)
    }

    func testSingleServerRetriesItselfIndefinitely() throws {
        var (p, t) = try running(["A"], existing: nil)
        for n in 0..<35 {
            if n > 0 { t = try probe(p.tick(now: Double(n * 2))) }
            _ = try p.probeCompleted(t, reachable: false, now: Double(n * 2) + 0.1)
            XCTAssertEqual(p.selectedServerID, "A")
        }
        XCTAssertEqual(p.consecutiveFailures, 5)
    }

    func testCandidateSuccessRequiresActivationThenActiveProbe() throws {
        var (p, t) = try running(existing: nil)
        let a = try activation(p.probeCompleted(t, reachable: true, now: 0.1))
        XCTAssertEqual(p.phase, .switching)
        XCTAssertNil(p.activeServerID)
        XCTAssertEqual(try p.tick(now: 2), [])
        let effects = try p.activationCompleted(a, succeeded: true, now: 3)
        let confirmation = try probe(effects)
        XCTAssertEqual(effects, [.probe(confirmation, .activeTunnel)])
        XCTAssertEqual(p.phase, .checking)
        XCTAssertEqual(p.activeServerID, "A")
        _ = try p.probeCompleted(confirmation, reachable: true, now: 3.1)
        XCTAssertEqual(p.phase, .connected)
    }

    func testActivationFailureMovesNextButDoesNotClaimConnected() throws {
        var (p, t) = try running(existing: nil)
        let a = try activation(p.probeCompleted(t, reachable: true, now: 0.1))
        XCTAssertEqual(try p.activationCompleted(a, succeeded: false, now: 0.2), [.unavailable("A")])
        XCTAssertNil(p.activeServerID)
        XCTAssertEqual(p.phase, .checking)
        XCTAssertEqual(p.selectedServerID, "B")
        XCTAssertEqual(try p.tick(now: 2.19), [])
        XCTAssertEqual(try probe(p.tick(now: 2.2)).serverID, "B")
    }

    func testHangingActivationIsBoundedAndCancelled() throws {
        var (p, t) = try running(existing: nil)
        let a = try activation(p.probeCompleted(t, reachable: true, now: 0.1))
        XCTAssertEqual(try p.tick(now: 15), [])
        XCTAssertEqual(try p.tick(now: a.deadline), [.cancel(a), .unavailable("A")])
        XCTAssertEqual(p.selectedServerID, "B")
        XCTAssertEqual(try p.activationCompleted(a, succeeded: true, now: 16), [])
        XCTAssertNil(p.activeServerID)
    }

    func testLateActivationSuccessIsNotAcceptedAtDeadline() throws {
        var (p, t) = try running(existing: nil)
        let a = try activation(p.probeCompleted(t, reachable: true, now: 0.1))
        XCTAssertEqual(try p.activationCompleted(a, succeeded: true, now: a.deadline),
                       [.cancel(a), .unavailable("A")])
        XCTAssertNil(p.activeServerID)
    }

    func testFailedConfirmationNeverShowsConnected() throws {
        var (p, t) = try running(existing: nil)
        let a = try activation(p.probeCompleted(t, reachable: true, now: 0.1))
        let check = try probe(p.activationCompleted(a, succeeded: true, now: 0.2))
        _ = try p.probeCompleted(check, reachable: false, now: 0.3)
        XCTAssertEqual(p.phase, .checking)
        XCTAssertEqual(p.consecutiveFailures, 1)
    }

    func testStopCancelsProbeAndInvalidatesItsSuccess() throws {
        var (p, t) = try running()
        let effects = try p.stop(now: 0.1)
        XCTAssertEqual(effects.first, .cancel(t))
        let d = try disconnection(effects)
        XCTAssertNotEqual(t.generation, d.generation)
        XCTAssertEqual(try p.probeCompleted(t, reachable: true, now: 0.2), [])
        XCTAssertEqual(p.phase, .stopping)
        XCTAssertEqual(try p.tick(now: 2), [])
        _ = try p.disconnectionCompleted(d, succeeded: true, now: 3)
        XCTAssertEqual(p.phase, .stopped)
        XCTAssertNil(p.activeServerID)
        XCTAssertNil(p.selectedServerID)
        XCTAssertEqual(try p.tick(now: 1000), [])
    }

    func testStopDuringActivationCannotBeOverriddenByLateCompletion() throws {
        var (p, t) = try running(existing: nil)
        let a = try activation(p.probeCompleted(t, reachable: true, now: 0.1))
        let effects = try p.stop(now: 0.2)
        XCTAssertEqual(effects.first, .cancel(a))
        let d = try disconnection(effects)
        XCTAssertEqual(try p.activationCompleted(a, succeeded: true, now: 0.3), [])
        _ = try p.disconnectionCompleted(d, succeeded: true, now: 0.4)
        XCTAssertEqual(p.phase, .stopped)
        XCTAssertEqual(try p.tick(now: 100), [])
    }

    func testStopAfterSuccessfulProbeStillCancelsScheduledChecks() throws {
        var (p, t) = try running()
        _ = try p.probeCompleted(t, reachable: true, now: 0.1)
        let effects = try p.stop(now: 0.2)
        XCTAssertEqual(effects.count, 1) // disconnect, nothing is in flight
        let d = try disconnection(effects)
        _ = try p.disconnectionCompleted(d, succeeded: true, now: 0.3)
        XCTAssertEqual(try p.tick(now: 2), [])
    }

    func testRepeatedStopIsIdempotent() throws {
        var (p, _) = try running()
        let effects = try p.stop(now: 0.1)
        XCTAssertEqual(try p.stop(now: 0.2), [])
        let d = try disconnection(effects)
        _ = try p.disconnectionCompleted(d, succeeded: true, now: 0.3)
        XCTAssertEqual(try p.stop(now: 0.4), [])
    }

    func testFailedStopDoesNotResumeAndCanRetryExplicitly() throws {
        var (p, _) = try running()
        let d = try disconnection(p.stop(now: 0.1))
        _ = try p.disconnectionCompleted(d, succeeded: false, now: 0.2)
        XCTAssertEqual(p.phase, .stopFailed)
        XCTAssertEqual(p.activeServerID, "A") // not falsely marked disconnected
        XCTAssertEqual(try p.tick(now: 200), [])
        XCTAssertThrowsError(try p.start(servers: ["B"], now: 200))
        let retry = try disconnection(p.stop(now: 201))
        _ = try p.disconnectionCompleted(retry, succeeded: true, now: 201.1)
        XCTAssertEqual(p.phase, .stopped)
    }

    func testDisconnectTimeoutIsNotReportedAsSuccess() throws {
        var (p, _) = try running()
        let d = try disconnection(p.stop(now: 0.1))
        XCTAssertEqual(try p.tick(now: d.deadline), [.cancel(d)])
        XCTAssertEqual(p.phase, .stopFailed)
        XCTAssertEqual(try p.disconnectionCompleted(d, succeeded: true, now: 20), [])
        XCTAssertEqual(p.phase, .stopFailed)
    }

    func testDisconnectSuccessAtDeadlineIsTooLate() throws {
        var (p, _) = try running()
        let d = try disconnection(p.stop(now: 0.1))
        XCTAssertEqual(try p.disconnectionCompleted(d, succeeded: true, now: d.deadline), [.cancel(d)])
        XCTAssertEqual(p.phase, .stopFailed)
    }

    func testOldGenerationCannotAffectNewRun() throws {
        var (p, old) = try running()
        let d = try disconnection(p.stop(now: 0.1))
        _ = try p.disconnectionCompleted(d, succeeded: true, now: 0.2)
        let fresh = try probe(p.start(servers: ["A"], existingServerID: "A", now: 0.3))
        XCTAssertNotEqual(fresh.generation, old.generation)
        XCTAssertEqual(try p.probeCompleted(old, reachable: false, now: 0.4), [])
        XCTAssertEqual(try p.disconnectionCompleted(d, succeeded: true, now: 0.5), [])
        XCTAssertEqual(p.phase, .checking)
        XCTAssertEqual(p.consecutiveFailures, 0)
        _ = try p.probeCompleted(fresh, reachable: true, now: 0.6)
        XCTAssertEqual(p.phase, .connected)
    }

    func testDoubleStartRejectedWithoutReplacingPendingProbe() throws {
        var (p, t) = try running()
        XCTAssertThrowsError(try p.start(servers: ["B"], now: 0.1))
        _ = try p.probeCompleted(t, reachable: true, now: 0.2)
        XCTAssertEqual(p.activeServerID, "A")
        XCTAssertEqual(p.phase, .connected)
    }

    func testClockRejectsNegativeNaNInfinityAndRegression() throws {
        for now in [-1, Double.nan, Double.infinity] {
            var p = P()
            XCTAssertThrowsError(try p.start(servers: ["A"], now: now))
            XCTAssertEqual(p.phase, .stopped)
        }
        var (p, _) = try running()
        _ = try p.tick(now: 1)
        XCTAssertThrowsError(try p.tick(now: 0.99))
    }

    func testStaleTimestampFromIgnoredCompletionDoesNotBreakClock() throws {
        var (p, old) = try running()
        let fresh = try probe(p.tick(now: 2))
        XCTAssertEqual(try p.probeCompleted(old, reachable: true, now: 1), [])
        _ = try p.probeCompleted(fresh, reachable: true, now: 2.1)
        XCTAssertEqual(p.phase, .connected)
    }
}
