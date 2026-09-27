import CoreLocation
import Foundation
import Observation
import RaceCore
import UIKit

/// Runs a timing session: sensors → fusion → lap timer → predictive delta → UI / voice / GoPro.
@MainActor
@Observable
final class LiveSessionController {
    enum Phase: Equatable { case idle, waitingForGPS, findingLine, outLap, onLap, finished }

    // Public state for the dashboard
    private(set) var phase: Phase = .idle
    private(set) var track: Track
    private(set) var reading: DeltaEngine.Reading?
    private(set) var lapElapsed: Double = 0
    private(set) var laps: [Lap] = []
    private(set) var lastLap: Lap?
    private(set) var sessionBest: Lap?
    private(set) var reference: Lap?
    private(set) var speed: Double = 0
    private(set) var longG: Double = 0
    private(set) var latG: Double = 0
    private(set) var gpsAccuracy: Double = 0
    private(set) var gpsRate: Double = 0
    private(set) var imuAligned = false
    /// Split deltas for the running lap vs the reference, per sector index.
    private(set) var splitDeltas: [Double] = []
    private(set) var flash: String?
    private(set) var trace: [GeoPoint] = []

    let vehicle: Vehicle?
    private let settings: AppSettings
    private let goPro: GoProService
    private let speech: Speech

    private let location = LocationService()
    private let motion = MotionService()
    private let external = ExternalGPSService()
    private let fusion: SensorFusion
    private let aligner = ImuAligner()
    @ObservationIgnored private var timer: LapTimer
    private let delta = DeltaEngine()
    @ObservationIgnored private var samples: [TelemetrySample] = []
    @ObservationIgnored private var startDate = Date()
    @ObservationIgnored private var startUptime = ProcessInfo.processInfo.systemUptime
    @ObservationIgnored private var fixTimes: [Double] = []
    @ObservationIgnored private var lastUIUpdate = 0.0
    @ObservationIgnored private var lastRecorded = -1.0
    @ObservationIgnored private var lastCallout = -100.0

    init(track: Track, vehicle: Vehicle?, reference: Lap?, settings: AppSettings, goPro: GoProService, speech: Speech) {
        self.track = track
        self.vehicle = vehicle
        self.reference = reference
        self.settings = settings
        self.goPro = goPro
        self.speech = speech
        fusion = SensorFusion(origin: track.location)
        timer = LapTimer(track: track)
        delta.setReference(reference, projection: track.projection)
    }

    var sourceDescription: String {
        switch settings.gpsSource {
        case .phone: imuAligned ? "iPhone GPS + IMU" : "iPhone GPS (aligning IMU…)"
        case .raceBox: "RaceBox"
        case .nmea: "BT GPS"
        }
    }

    // MARK: Lifecycle

    func start() {
        UIApplication.shared.isIdleTimerDisabled = true
        startDate = Date()
        startUptime = ProcessInfo.processInfo.systemUptime
        phase = .waitingForGPS

        switch settings.gpsSource {
        case .phone:
            location.onLocation = { [weak self] l in self?.handle(location: l) }
            location.requestAuthorization()
            location.start()
            motion.onSample = { [weak self] ts, a in
                Task { @MainActor in self?.handle(imuUptime: ts, accel: a) }
            }
            motion.start()
        case .raceBox, .nmea:
            external.onFix = { [weak self] f in self?.handle(external: f) }
            external.scan(mode: settings.gpsSource)
        }

        if settings.goProAutoRecord, goPro.isReady { goPro.setRecording(true) }
    }

    /// Stops sensors and returns the recorded session.
    func stop() -> Session {
        location.stop()
        motion.stop()
        external.disconnect()
        UIApplication.shared.isIdleTimerDisabled = false
        if goPro.isRecording { goPro.setRecording(false) }
        phase = .finished
        return Session(
            trackID: track.id, trackName: track.name, vehicle: vehicle,
            startDate: startDate, laps: laps, samples: samples
        )
    }

    /// Discovered start/finish gate (unsurveyed track), so the caller can persist it.
    var inferredGate: Gate? { timer.track.startFinish }

    // MARK: Sensor handlers

    private func sessionTime(_ date: Date) -> Double { date.timeIntervalSince(startDate) }
    private func sessionTime(uptime: TimeInterval) -> Double { uptime - startUptime }

    private func handle(location l: CLLocation) {
        guard l.horizontalAccuracy >= 0, l.horizontalAccuracy < 30 else { return }
        let t = sessionTime(l.timestamp)
        noteFix(t)
        let fix = SensorFusion.GPSFix(
            t: t, position: GeoPoint(l.coordinate), speed: l.speed, course: l.course,
            horizontalAccuracy: l.horizontalAccuracy,
            speedAccuracy: l.speedAccuracy > 0 ? l.speedAccuracy : 0.5,
            altitude: l.altitude
        )
        if l.speed >= 0, l.course >= 0 {
            let c = Geo.deg2rad(l.course)
            aligner.addGPSVelocity(t: t, velocity: Vec2(l.speed * sin(c), l.speed * cos(c)))
            imuAligned = aligner.theta != nil
        }
        // Until the IMU is aligned the filter runs as constant-velocity (still smooths GPS noise).
        process(fusion.ingestGPS(fix))
    }

    private func handle(imuUptime: TimeInterval, accel: Vec2) {
        aligner.addIMU(accel)
        guard let en = aligner.toEN(accel) else { return }
        if let s = fusion.ingestIMU(t: sessionTime(uptime: imuUptime), accelEN: en) { process(s) }
    }

    private func handle(external f: ExternalGPSService.Fix) {
        let t = sessionTime(uptime: f.receivedUptime)
        noteFix(t)
        let s = TelemetrySample(
            t: t, position: f.position, speed: f.speed, heading: f.course, altitude: f.altitude,
            accuracy: f.accuracy, longG: f.longG ?? 0, latG: f.latG ?? 0,
            source: settings.gpsSource == .raceBox ? .raceBox : .nmea
        )
        process(s)
    }

    private func noteFix(_ t: Double) {
        fixTimes.append(t)
        fixTimes.removeAll { t - $0 > 2 }
        gpsRate = Double(fixTimes.count) / 2
    }

    // MARK: Pipeline

    private func process(_ s: TelemetrySample) {
        // Record at ≤ 25 Hz.
        if s.t - lastRecorded >= 0.039 {
            samples.append(s)
            lastRecorded = s.t
        }
        for e in timer.ingest(s) { handle(e) }

        if phase == .waitingForGPS { phase = timer.track.startFinish == nil ? .findingLine : .outLap }
        if let el = timer.elapsed(at: s.t) {
            lapElapsed = el
            if let r = delta.update(sample: s, lapElapsed: el) { reading = r }
        }

        // Throttle UI to ~20 Hz; heavy views (map trace) at 2 Hz.
        guard s.t - lastUIUpdate > 0.05 else { return }
        speed = s.speed
        longG = s.longG
        latG = s.latG
        gpsAccuracy = s.accuracy
        if trace.isEmpty || Geo.distance(trace.last!, s.position) > 5 {
            trace.append(s.position)
            if trace.count > 3000 { trace.removeFirst(trace.count - 3000) }
        }
        lastUIUpdate = s.t
        maybeCalloutDelta(at: s.t)
    }

    private func handle(_ e: LapTimer.Event) {
        switch e {
        case let .gateInferred(g):
            track.startFinish = g
            flash = "Start/finish line found"
            phase = .outLap
            speech.say("Start finish line found. Timing from the next lap.")
        case .lapStarted:
            phase = .onLap
            splitDeltas = []
            delta.resetLap()
            reading = nil
        case let .split(_, index, time):
            if let ref = reference, index < ref.splits.count {
                splitDeltas.append(time - ref.splits[index])
            }
        case let .lapCompleted(lap):
            laps.append(lap)
            lastLap = lap
            let prevBest = sessionBest
            if prevBest == nil || lap.time < prevBest!.time { sessionBest = lap }
            let isPB = reference == nil || lap.time < reference!.time
            if isPB {
                // Live reference switches to the new best: the delta now chases your best lap.
                reference = lap
                delta.setReference(lap, projection: track.projection)
                flash = "PERSONAL BEST \(LapTimeFormat.string(lap.time))"
            } else {
                flash = "Lap \(lap.number)  \(LapTimeFormat.string(lap.time))"
            }
            if settings.voiceLapTimes {
                var text = "Lap \(lap.number), \(spoken(lap.time))."
                if isPB { text += " Personal best!" } else if let ref = reference {
                    text += String(format: " Plus %.1f.", lap.time - ref.time)
                }
                speech.say(text, interrupt: true)
            }
        }
    }

    /// Short voice callouts of the delta every ~20 s while on a lap ("minus zero point three").
    private func maybeCalloutDelta(at t: Double) {
        guard settings.voiceDelta, phase == .onLap, let r = reading, t - lastCallout > 20 else { return }
        lastCallout = t
        let sign = r.delta < 0 ? "minus" : "plus"
        speech.say("\(sign) \(String(format: "%.1f", abs(r.delta)))")
    }

    private func spoken(_ t: Double) -> String {
        let m = Int(t / 60)
        let s = t - Double(m * 60)
        return m > 0 ? String(format: "%d %05.2f", m, s) : String(format: "%.2f", s)
    }

    func clearFlash() { flash = nil }
}
