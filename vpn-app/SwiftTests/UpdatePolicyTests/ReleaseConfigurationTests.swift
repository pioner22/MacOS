import Foundation
import XCTest
@testable import UpdatePolicy

final class ReleaseConfigurationTests: XCTestCase {
    func valid() -> [String: Any] {
        [
            "VPNReleaseBuild": true,
            "CFBundleIdentifier": ReleaseConfiguration.bundleID,
            "CFBundleShortVersionString": "0.1.0",
            "CFBundleVersion": "1",
            "SUFeedURL": ReleaseConfiguration.feed,
            "SUPublicEDKey": Data(0..<32).base64EncodedString(),
            "SUVerifyUpdateBeforeExtraction": true,
            "SURequireSignedFeed": true,
            "SUSignedFeedFailureExpirationInterval": 0,
            "SUEnableJavaScript": false,
            "SUEnableSystemProfiling": false,
            "SUEnableAutomaticChecks": false,
            "SUAutomaticallyUpdate": false,
            "SUAllowsAutomaticUpdates": false
        ]
    }
    func rejects(_ key: String, _ value: Any) {
        var info = valid(); info[key] = value
        XCTAssertThrowsError(try ReleaseConfiguration(info: info), "must reject \(key)")
    }
    func testValidConfiguration() throws {
        let configuration = try ReleaseConfiguration(info: valid())
        XCTAssertEqual(configuration.build, 1)
        XCTAssertEqual(configuration.version, "0.1.0")
    }
    func testDevelopmentBuildNeverStartsUpdater() { rejects("VPNReleaseBuild", false) }
    func testMissingConfigurationNeverStartsUpdater() {
        XCTAssertThrowsError(try ReleaseConfiguration(info: [:]))
    }
    func testWrongAppRejected() { rejects("CFBundleIdentifier", "org.example.OtherApp") }
    func testHTTPRejected() { rejects("SUFeedURL", ReleaseConfiguration.feed.replacingOccurrences(of: "https:", with: "http:")) }
    func testForeignFeedRejected() { rejects("SUFeedURL", "https://example.com/appcast.xml") }
    func testLookalikeHostRejected() { rejects("SUFeedURL", ReleaseConfiguration.feed.replacingOccurrences(of: ".com/", with: ".com.evil/")) }
    func testFeedCredentialsRejected() { rejects("SUFeedURL", "https://user:pass@raw.githubusercontent.com/appcast.xml") }
    func testPreviewFeedNotImplicitlyTrusted() { rejects("SUFeedURL", ReleaseConfiguration.feed + "?channel=beta") }
    func testMissingKeyRejected() { rejects("SUPublicEDKey", "") }
    func testMalformedKeyRejected() { rejects("SUPublicEDKey", "not-a-key") }
    func testWrongKeySizeRejected() { rejects("SUPublicEDKey", Data(repeating: 1, count: 31).base64EncodedString()) }
    func testDummyKeyRejected() { rejects("SUPublicEDKey", Data(repeating: 0, count: 32).base64EncodedString()) }
    func testKeyWhitespaceRejected() { rejects("SUPublicEDKey", Data(0..<32).base64EncodedString() + "\n") }
    func testZeroBuildRejected() { rejects("CFBundleVersion", "0") }
    func testOverflowBuildRejected() { rejects("CFBundleVersion", "2147483648") }
    func testNonDecimalBuildRejected() { rejects("CFBundleVersion", "1.2") }
    func testPrereleaseVersionRejected() { rejects("CFBundleShortVersionString", "0.1.0-beta.1") }
    func testVersionNewlineRejected() { rejects("CFBundleShortVersionString", "0.1.0\n") }
    func testLeadingZeroBuildRejected() { rejects("CFBundleVersion", "01") }
    func testExtractionVerificationMandatory() { rejects("SUVerifyUpdateBeforeExtraction", false) }
    func testSignedFeedMandatory() { rejects("SURequireSignedFeed", false) }
    func testSignedFeedFailureCannotExpire() { rejects("SUSignedFeedFailureExpirationInterval", 1728000) }
    func testJavascriptDisabled() { rejects("SUEnableJavaScript", true) }
    func testProfilingDisabled() { rejects("SUEnableSystemProfiling", true) }
    func testScheduledChecksOffByDefault() { rejects("SUEnableAutomaticChecks", true) }
    func testSilentInstallDisabled() { rejects("SUAutomaticallyUpdate", true) }
    func testUserConsentAlwaysRequired() { rejects("SUAllowsAutomaticUpdates", true) }
    func testCheckingWhileConnectedAllowed() { XCTAssertTrue(VPNActivity.connected.allowsApplicationUpdate) }
    func testCheckingWhileIdleAllowed() { XCTAssertTrue(VPNActivity.idle.allowsApplicationUpdate) }
    func testTransitionsBlockApplicationUpdate() {
        for state in [VPNActivity.connecting, .disconnecting, .applyingServiceUpdate] {
            XCTAssertFalse(state.allowsApplicationUpdate)
        }
    }
}
