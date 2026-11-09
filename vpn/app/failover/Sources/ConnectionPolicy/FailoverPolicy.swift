import Foundation

/// Deterministic decision layer only. Call serially from a single owner.
/// No sockets, timers, privileges, credentials, shell commands or TUN writes.
/// The adapter must execute/cancel effects and feed completions back by ticket.
public struct FailoverPolicy {
    public static let interval: TimeInterval = 2
    public static let probeTimeout: TimeInterval = 2
    public static let failuresBeforeSwitch = 10
    public static let operationTimeout: TimeInterval = 15

    public enum Phase: Equatable {
        case stopped, checking, switching, connected, stopping, stopFailed
    }

    public enum Scope: Equatable { case candidate, activeTunnel }

    /// Fresh UUID for every attempt prevents stale results after Stop/restart.
    public struct Ticket: Equatable {
        public let id: UUID
        public let generation: UUID
        public let serverID: String?
        public let deadline: TimeInterval
    }

    public enum Effect: Equatable {
        case probe(Ticket, Scope)
        case activate(Ticket)
        case cancel(Ticket)
        case disconnect(Ticket)
        case unavailable(String)
    }

    public enum PolicyError: Error, Equatable {
        case emptyServers, invalidServerID, duplicateServers, unknownInitialServer
        case alreadyRunning, invalidClock
    }

    private enum Pending {
        case probe(Ticket, Scope), activate(Ticket), disconnect(Ticket)
        var ticket: Ticket {
            switch self {
            case .probe(let t, _), .activate(let t), .disconnect(let t): return t
            }
        }
    }

    public private(set) var phase: Phase = .stopped
    public private(set) var consecutiveFailures = 0
    /// Applied by backend; not necessarily healthy. Check phase == .connected.
    public private(set) var activeServerID: String?
    public var selectedServerID: String? { servers.isEmpty ? nil : servers[index] }

    private var servers: [String] = []
    private var index = 0
    private var generation = UUID()
    private var pending: Pending?
    private var nextProbeAt: TimeInterval = 0
    private var lastTime: TimeInterval = 0

    public init() {}

    /// A monotonic timestamp is required, e.g. system uptime, not a wall clock.
    private mutating func observe(_ now: TimeInterval) throws {
        guard now.isFinite, now >= lastTime else { throw PolicyError.invalidClock }
        lastTime = now
    }

    private func ticket(serverID: String?, now: TimeInterval,
                        timeout: TimeInterval) -> Ticket {
        Ticket(id: UUID(), generation: generation, serverID: serverID,
               deadline: now + timeout)
    }

    /// Snapshot the ordered, user-enabled profile IDs, never their secrets.
    /// An existing tunnel is re-checked; start does not assume it is healthy.
    public mutating func start(servers ids: [String],
                               existingServerID: String? = nil,
                               now: TimeInterval) throws -> [Effect] {
        guard phase == .stopped else { throw PolicyError.alreadyRunning }
        guard !ids.isEmpty else { throw PolicyError.emptyServers }
        guard ids.allSatisfy({ !$0.isEmpty && $0.count <= 256 &&
            $0.unicodeScalars.allSatisfy({ !CharacterSet.controlCharacters.contains($0) })
        }) else { throw PolicyError.invalidServerID }
        guard Set(ids).count == ids.count else { throw PolicyError.duplicateServers }
        if let initial = existingServerID, !ids.contains(initial) {
            throw PolicyError.unknownInitialServer
        }
        try observe(now)
        servers = ids
        index = existingServerID.flatMap { ids.firstIndex(of: $0) } ?? 0
        activeServerID = existingServerID
        consecutiveFailures = 0
        generation = UUID()
        nextProbeAt = now
        phase = .checking
        return try tick(now: now)
    }

    /// One tick can expire at most one probe. No catch-up burst after sleep.
    /// At most one current operation is issued; cancellations precede replacements.
    public mutating func tick(now: TimeInterval) throws -> [Effect] {
        try observe(now)
        guard phase != .stopped && phase != .stopFailed else { return [] }
        var effects: [Effect] = []
        if let operation = pending {
            guard now >= operation.ticket.deadline else { return [] }
            pending = nil
            effects.append(.cancel(operation.ticket))
            switch operation {
            case .probe:
                effects += failedProbe()
            case .activate:
                // Local activation failure is not disguised as 10 network probes.
                effects += moveToNext()
                nextProbeAt = now + Self.interval
            case .disconnect:
                phase = .stopFailed
                return effects // no automatic restart or false "disconnected"
            }
        }
        if pending == nil && (phase == .checking || phase == .connected),
           now >= nextProbeAt, let server = selectedServerID {
            let attempt = ticket(serverID: server, now: now, timeout: Self.probeTimeout)
            let scope: Scope = activeServerID == server ? .activeTunnel : .candidate
            pending = .probe(attempt, scope)
            nextProbeAt = now + Self.interval // start-to-start, not response+2s
            effects.append(.probe(attempt, scope))
        }
        return effects
    }

    /// Reachable means a bounded round succeeded THROUGH this profile with TLS
    /// validation, not merely ICMP/TCP-connect or a direct internet request.
    public mutating func probeCompleted(_ attempt: Ticket, reachable: Bool,
                                        now: TimeInterval) throws -> [Effect] {
        guard case .probe(let current, let scope)? = pending,
              current == attempt else { return [] }
        try observe(now)
        guard now < current.deadline else { return try tick(now: now) }
        pending = nil
        if !reachable { return failedProbe() }
        consecutiveFailures = 0
        if scope == .activeTunnel {
            phase = .connected
            return []
        }
        phase = .switching
        let activation = ticket(serverID: current.serverID, now: now,
                                timeout: Self.operationTimeout)
        pending = .activate(activation)
        return [.activate(activation)]
    }

    /// Success acknowledges application only. An active-tunnel probe must pass
    /// before the UI is allowed to display Connected.
    public mutating func activationCompleted(_ attempt: Ticket, succeeded: Bool,
                                             now: TimeInterval) throws -> [Effect] {
        guard case .activate(let current)? = pending, current == attempt else { return [] }
        try observe(now)
        guard now < current.deadline else { return try tick(now: now) }
        pending = nil
        if !succeeded {
            nextProbeAt = now + Self.interval
            return moveToNext()
        }
        activeServerID = current.serverID
        phase = .checking
        nextProbeAt = now
        return try tick(now: now)
    }

    private mutating func failedProbe() -> [Effect] {
        phase = .checking
        consecutiveFailures += 1
        guard consecutiveFailures >= Self.failuresBeforeSwitch else { return [] }
        return moveToNext()
    }

    private mutating func moveToNext() -> [Effect] {
        guard let server = selectedServerID else { return [] }
        index = (index + 1) % servers.count
        consecutiveFailures = 0
        phase = .checking
        return [.unavailable(server)] // unavailable from this client, not globally dead
    }

    /// Stop wins over probes and activations. Backend must fence old-generation
    /// writes before acknowledging disconnect; ignoring callbacks alone is not enough.
    public mutating func stop(now: TimeInterval) throws -> [Effect] {
        try observe(now)
        guard phase != .stopped && phase != .stopping else { return [] }
        var effects: [Effect] = []
        if let old = pending { effects.append(.cancel(old.ticket)) }
        generation = UUID()
        consecutiveFailures = 0
        phase = .stopping
        let request = ticket(serverID: nil, now: now, timeout: Self.operationTimeout)
        pending = .disconnect(request)
        effects.append(.disconnect(request))
        return effects
    }

    /// Failure never resumes the loop. Explicit Stop can retry cleanup.
    public mutating func disconnectionCompleted(_ attempt: Ticket, succeeded: Bool,
                                                now: TimeInterval) throws -> [Effect] {
        guard case .disconnect(let current)? = pending, current == attempt else { return [] }
        try observe(now)
        guard now < current.deadline else { return try tick(now: now) }
        pending = nil
        phase = succeeded ? .stopped : .stopFailed
        if succeeded {
            activeServerID = nil
            servers = []
            index = 0
        }
        return []
    }
}
