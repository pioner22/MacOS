import XCTest
@testable import UpdatePolicy
#if canImport(Darwin)
import Darwin
#else
import Glibc
#endif

final class UpdateEvidenceTests: XCTestCase {
    func testBuildValidation() {
        for value in ["", "0", "01", "1\n", " 1", "+1", "-1", "1.0", "2147483648", "9999999999999"] {
            XCTAssertNil(UpdateEvidence.build(value), value)
        }
        XCTAssertEqual(UpdateEvidence.build("2147483647"), 2147483647)
    }
    func testLatestRequiresAllEvidence() {
        for signature in [false, true] {
            for reason in [false, true] {
                for stable in [false, true] {
                    let result = UpdateEvidence.latest(running: 32, itemBuild: "32", signatureValid: signature,
                                                        onLatestVersion: reason, stableChannel: stable)
                    XCTAssertEqual(result, signature && reason && stable ? .latest(verifiedBuild: 32) : .unknown)
                }
            }
        }
    }
    func testDifferentOrMissingVersionFailsClosed() {
        for build in [nil, "", "31", "33", "032", "32.0"] as [String?] {
            XCTAssertEqual(UpdateEvidence.latest(running: 32, itemBuild: build, signatureValid: true,
                                                  onLatestVersion: true, stableChannel: true), .unknown)
        }
    }
    func testSubscriptionResultValidation() {
        XCTAssertEqual(UpdateEvidence.subscription(code: 0, data: Data(#"{"schema":1,"result":"updated"}"#.utf8)), .updated)
        XCTAssertEqual(UpdateEvidence.subscription(code: 0, data: Data(#"{"schema":1,"result":"notApplicable"}"#.utf8)), .notApplicable)
        for value in [#"{"schema":true,"result":"updated"}"#, #"{"schema":1.1,"result":"updated"}"#,
                      #"{"schema":1,"result":"updated","password":"bad"}"#, #"{"schema":1,"result":"failed"}"#,
                      #"{"result":"updated"}"#, "not JSON", "[]", "null"] {
            XCTAssertNil(UpdateEvidence.subscription(code: 0, data: Data(value.utf8)))
        }
    }
    func testNonzeroExitCannotSucceed() {
        XCTAssertNil(UpdateEvidence.subscription(code: 1, data: Data(#"{"schema":1,"result":"updated"}"#.utf8)))
        XCTAssertNil(UpdateEvidence.subscription(code: 0, data: Data(repeating: 32, count: 4097)))
    }
}

final class UpdateStoreTests: XCTestCase {
    var root: URL!
    override func setUpWithError() throws {
        root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false)
    }
    override func tearDownWithError() throws { try FileManager.default.removeItem(at: root) }
    var target: URL { root.appendingPathComponent("state") }
    func receipt() -> UnifiedUpdateWorkflow.Continuation {
        var flow = try! UnifiedUpdateWorkflow(runningBuild: 32)
        _ = flow.begin(); let id = flow.operation!
        _ = flow.checked(.newer(build: 33), operation: id)
        guard case .saveContinuation(let saved) = flow.approveInstallation(operation: id, now: Date())[0] else {
            fatalError("no receipt")
        }
        return saved
    }
    func testAtomicRoundTripAndRemoval() throws {
        let store = try UpdateContinuationStore(directoryURL: target)
        let saved = receipt()
        XCTAssertNil(try store.load())
        try store.save(saved)
        XCTAssertEqual(try store.load(), saved)
        try store.save(saved)
        XCTAssertEqual(try store.load(), saved)
        try store.remove(); try store.remove(); XCTAssertNil(try store.load())
        let attrs = try FileManager.default.attributesOfItem(atPath: target.path)
        XCTAssertEqual((attrs[.posixPermissions] as? NSNumber)?.intValue, 0o700)
    }
    func testFileModeIsPrivate() throws {
        let store = try UpdateContinuationStore(directoryURL: target); try store.save(receipt())
        let attrs = try FileManager.default.attributesOfItem(atPath: target.appendingPathComponent("pending-update.json").path)
        XCTAssertEqual((attrs[.posixPermissions] as? NSNumber)?.intValue, 0o600)
    }
    func testIndependentInstancesCannotOverlap() throws {
        let one = try UpdateContinuationStore(directoryURL: target)
        let two = try UpdateContinuationStore(directoryURL: target)
        try one.acquireLock(); try one.acquireLock()
        XCTAssertThrowsError(try two.acquireLock())
        one.releaseLock(); try two.acquireLock(); two.releaseLock()
    }
    func testPublicStateDirectoryRejected() throws {
        try FileManager.default.createDirectory(at: target, withIntermediateDirectories: false)
        chmod(target.path, 0o755)
        XCTAssertThrowsError(try UpdateContinuationStore(directoryURL: target))
    }
    func testDirectorySymlinkRejected() throws {
        try FileManager.default.createSymbolicLink(at: target, withDestinationURL: root)
        XCTAssertThrowsError(try UpdateContinuationStore(directoryURL: target))
    }
    func testReceiptSymlinkNotReadOrWritten() throws {
        let store = try UpdateContinuationStore(directoryURL: target)
        let outside = root.appendingPathComponent("outside")
        try Data("untouched".utf8).write(to: outside)
        try FileManager.default.createSymbolicLink(at: target.appendingPathComponent("pending-update.json"), withDestinationURL: outside)
        XCTAssertThrowsError(try store.load()); XCTAssertThrowsError(try store.save(receipt()))
        try store.remove()
        XCTAssertEqual(try String(contentsOf: outside), "untouched")
    }
    func testHardLinkedReceiptRejected() throws {
        let store = try UpdateContinuationStore(directoryURL: target); try store.save(receipt())
        try FileManager.default.linkItem(at: target.appendingPathComponent("pending-update.json"), to: root.appendingPathComponent("hardlink"))
        XCTAssertThrowsError(try store.load())
    }
    func testLockSymlinkRejected() throws {
        let store = try UpdateContinuationStore(directoryURL: target)
        try FileManager.default.createSymbolicLink(at: target.appendingPathComponent("update.lock"), withDestinationURL: root.appendingPathComponent("outside"))
        XCTAssertThrowsError(try store.acquireLock())
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent("outside").path))
    }
    func testOversizedReceiptRejected() throws {
        let store = try UpdateContinuationStore(directoryURL: target)
        let path = target.appendingPathComponent("pending-update.json")
        try Data(repeating: 32, count: 8193).write(to: path); chmod(path.path, 0o600)
        XCTAssertThrowsError(try store.load())
    }
    func testInvalidJSONRejected() throws {
        let store = try UpdateContinuationStore(directoryURL: target)
        let path = target.appendingPathComponent("pending-update.json")
        try Data("{}".utf8).write(to: path); chmod(path.path, 0o600)
        XCTAssertThrowsError(try store.load())
    }
}

final class SubscriptionQuotingTests: XCTestCase {
    func testShellQuotePreservesUntrustedCharactersAsOneArgument() throws {
        for text in ["abc", "a'b", "$(printf bad)", "a\nb", "\"; printf injected; #"] {
            let process = Process(); process.executableURL = URL(fileURLWithPath: "/bin/sh")
            process.arguments = ["-c", "/usr/bin/printf '%s' " + LegacySubscriptionService.shellQuote(text)]
            let pipe = Pipe(); process.standardOutput = pipe
            try process.run(); let output = pipe.fileHandleForReading.readDataToEndOfFile(); process.waitUntilExit()
            XCTAssertEqual(process.terminationStatus, 0)
            XCTAssertEqual(String(data: output, encoding: .utf8), text)
        }
    }
    func testAppleScriptLiteralEscapesSource() {
        XCTAssertEqual(LegacySubscriptionService.appleScriptQuote("a\nb\\c\""), "\"a\\nb\\\\c\\\"\"")
    }
}
