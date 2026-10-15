import Foundation
#if canImport(Darwin)
import Darwin
#else
import Glibc
#endif

/// No missing/empty appcast or incompatible release is treated as 'latest'.
public enum UpdateEvidence {
    public static func build(_ text: String) -> UInt32? {
        guard !text.isEmpty, text.first != "0",
              text.utf8.allSatisfy({ $0 >= 48 && $0 <= 57 }),
              let value = UInt32(text), value <= UnifiedUpdateWorkflow.maximumBuild else { return nil }
        return value
    }

    public static func latest(running: UInt32, itemBuild: String?,
                              signatureValid: Bool, onLatestVersion: Bool,
                              stableChannel: Bool) -> UnifiedUpdateWorkflow.CheckResult {
        guard signatureValid, onLatestVersion, stableChannel,
              let text = itemBuild, let value = build(text), value == running else { return .unknown }
        return .latest(verifiedBuild: value)
    }

    public static func subscription(code: Int32, data: Data) -> UnifiedUpdateWorkflow.SubscriptionResult? {
        guard code == 0, data.count <= 4096,
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              Set(object.keys) == Set(["schema", "result"]),
              let schema = object["schema"] as? NSNumber,
              CFGetTypeID(schema) != CFBooleanGetTypeID(), schema.intValue == 1,
              schema.doubleValue == 1 else { return nil }
        switch object["result"] as? String {
        case "updated": return .updated
        case "notApplicable": return .notApplicable
        default: return nil
        }
    }
}

import CoreFoundation

public enum UpdateStorageError: Error { case unsafePath, busy, io, oversized }

/// User-owned state only. All final path operations are relative to a held
/// directory descriptor; never follow a link, and never write a VPN profile.
public final class UpdateContinuationStore {
    private let directory: Int32
    private var lockFD: Int32 = -1
    private let filename = "pending-update.json"
    public static let limit = 8192

    public init(directoryURL: URL) throws {
        if mkdir(directoryURL.path, 0o700) != 0 && errno != EEXIST { throw UpdateStorageError.io }
        let fd = open(directoryURL.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard fd >= 0 else { throw UpdateStorageError.unsafePath }
        var info = stat()
        guard fstat(fd, &info) == 0, info.st_uid == geteuid(),
              (info.st_mode & 0o077) == 0 else {
            close(fd); throw UpdateStorageError.unsafePath
        }
        directory = fd
    }

    deinit { releaseLock(); close(directory) }

    private func checked(_ fd: Int32) throws {
        var info = stat()
        guard fd >= 0, fstat(fd, &info) == 0,
              (info.st_mode & S_IFMT) == S_IFREG, info.st_uid == geteuid(),
              info.st_nlink == 1, info.st_mode & 0o077 == 0 else { throw UpdateStorageError.unsafePath }
    }

    public func acquireLock() throws {
        guard lockFD < 0 else { return }
        let fd = openat(directory, "update.lock", O_CREAT | O_RDWR | O_NOFOLLOW | O_CLOEXEC, 0o600)
        do {
            try checked(fd)
            guard flock(fd, LOCK_EX | LOCK_NB) == 0 else { throw UpdateStorageError.busy }
            lockFD = fd
        } catch { if fd >= 0 { close(fd) }; throw error }
    }

    public func releaseLock() {
        if lockFD >= 0 { _ = flock(lockFD, LOCK_UN); close(lockFD); lockFD = -1 }
    }

    public func load() throws -> UnifiedUpdateWorkflow.Continuation? {
        let fd = openat(directory, filename, O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK)
        if fd < 0 && errno == ENOENT { return nil }
        defer { if fd >= 0 { close(fd) } }
        try checked(fd)
        var bytes = [UInt8](repeating: 0, count: Self.limit + 1)
        var total = 0
        while total < bytes.count {
            let capacity = bytes.count - total
            let count = bytes.withUnsafeMutableBytes { ptr in
                read(fd, ptr.baseAddress!.advanced(by: total), capacity)
            }
            if count < 0 { if errno == EINTR { continue }; throw UpdateStorageError.io }
            if count == 0 { break }
            total += count
        }
        guard total <= Self.limit else { throw UpdateStorageError.oversized }
        return try JSONDecoder().decode(UnifiedUpdateWorkflow.Continuation.self, from: Data(bytes.prefix(total)))
    }

    public func save(_ value: UnifiedUpdateWorkflow.Continuation) throws {
        let data = try JSONEncoder().encode(value)
        guard data.count <= Self.limit else { throw UpdateStorageError.oversized }
        // Refuse a pre-existing unsafe file; rename must not hide a linked target.
        _ = try load()
        let temp = ".pending-" + UUID().uuidString
        let fd = openat(directory, temp, O_CREAT | O_EXCL | O_WRONLY | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard fd >= 0 else { throw UpdateStorageError.io }
        defer { close(fd); _ = unlinkat(directory, temp, 0) }
        try checked(fd)
        var offset = 0
        while offset < data.count {
            let count = data.withUnsafeBytes { ptr in
                write(fd, ptr.baseAddress!.advanced(by: offset), data.count - offset)
            }
            if count < 0 { if errno == EINTR { continue }; throw UpdateStorageError.io }
            guard count > 0 else { throw UpdateStorageError.io }
            offset += count
        }
        guard fsync(fd) == 0, renameat(directory, temp, directory, filename) == 0 else { throw UpdateStorageError.io }
        guard fsync(directory) == 0 else { throw UpdateStorageError.io }
    }

    public func remove() throws {
        // Removing a filename cannot modify its symlink target or another user's data.
        if unlinkat(directory, filename, 0) != 0 && errno != ENOENT { throw UpdateStorageError.io }
        guard fsync(directory) == 0 else { throw UpdateStorageError.io }
    }
}
