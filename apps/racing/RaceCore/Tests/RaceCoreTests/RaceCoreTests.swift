import XCTest
@testable import RaceCore

final class GeoTests: XCTestCase {
    func testProjectionRoundTrip() {
        let proj = LocalProjection(origin: GeoPoint(lat: 50.3356, lon: 6.9475))
        let p = GeoPoint(lat: 50.3401, lon: 6.9512)
        let back = proj.toGeo(proj.toLocal(p))
        XCTAssertEqual(back.lat, p.lat, accuracy: 1e-9)
        XCTAssertEqual(back.lon, p.lon, accuracy: 1e-9)
        // Local distance matches great-circle distance within a few cm.
        XCTAssertEqual(proj.toLocal(p).length, Geo.distance(proj.origin, p), accuracy: 0.05)
    }

    func testAngleDiff() {
        XCTAssertEqual(Geo.angleDiff(350, 10), 20, accuracy: 1e-9)
        XCTAssertEqual(Geo.angleDiff(10, 350), -20, accuracy: 1e-9)
    }
}

final class TimingTests: XCTestCase {
    func testGateCrossingInterpolation() {
        let proj = Stadium.projection
        let gate = Gate(center: proj.toGeo(.zero), heading: 90, width: 20)
        let a = proj.toGeo(Vec2(-3, 0)), b = proj.toGeo(Vec2(1, 0))
        let f = GateCrossing.crossing(from: a, to: b, gate: gate, projection: proj)
        XCTAssertEqual(f ?? -1, 0.75, accuracy: 1e-6)
        // Wrong direction is ignored.
        XCTAssertNil(GateCrossing.crossing(from: b, to: a, gate: gate, projection: proj))
    }

    func testLapTimerMeasuresLapsAndSplits() {
        let timer = LapTimer(track: Stadium.track)
        var completed: [Lap] = []
        for s in Stadium.drive(laps: 3) {
            for case let .lapCompleted(lap) in timer.ingest(s) { completed.append(lap) }
        }
        XCTAssertEqual(completed.count, 3)
        for lap in completed {
            XCTAssertEqual(lap.time, Stadium.lapTime(), accuracy: 0.3)
            XCTAssertEqual(lap.splits.count, 2)
            XCTAssertEqual(lap.splits[0], lap.time / 2, accuracy: 0.3) // symmetric track
        }
    }

    func testStartFinishInferenceOnUnsurveyedTrack() {
        var track = Stadium.track
        track.startFinish = nil
        track.sectors = []
        let timer = LapTimer(track: track)
        var inferred = false
        var laps = 0
        for s in Stadium.drive(laps: 4) {
            for e in timer.ingest(s) {
                if case .gateInferred = e { inferred = true }
                if case .lapCompleted = e { laps += 1 }
            }
        }
        XCTAssertTrue(inferred)
        XCTAssertGreaterThanOrEqual(laps, 2)
        XCTAssertEqual(timer.laps.last?.time ?? 0, Stadium.lapTime(), accuracy: 0.3)
    }

    func testTheoreticalBest() {
        let a = Lap(number: 1, startTime: 0, endTime: 60, splits: [28, 60], samples: [])
        let b = Lap(number: 2, startTime: 60, endTime: 119, splits: [30, 59], samples: [])
        XCTAssertEqual(LapStats.theoreticalBest([a, b]) ?? 0, 28 + 29, accuracy: 1e-9)
        XCTAssertEqual(LapStats.best([a, b])?.number, 2)
    }

    func testLapTimeFormat() {
        XCTAssertEqual(LapTimeFormat.string(102.357), "1:42.357")
        XCTAssertEqual(LapTimeFormat.string(58.2041), "58.204")
        XCTAssertEqual(LapTimeFormat.delta(-0.234), "-0.23")
    }
}

final class DeltaTests: XCTestCase {
    private func laps(slow: Double) -> [Lap] {
        let timer = LapTimer(track: Stadium.track)
        for s in Stadium.drive(laps: 2, slowFactor: slow) { timer.ingest(s) }
        return timer.laps
    }

    func testDeltaAgainstSlowerLap() {
        let ref = laps(slow: 1.0)[0]
        let slower = laps(slow: 1.05)[0]
        let engine = DeltaEngine()
        engine.setReference(ref, projection: Stadium.projection)
        var last: DeltaEngine.Reading?
        var mid: DeltaEngine.Reading?
        for s in slower.samples {
            if let r = engine.update(sample: s, lapElapsed: s.t - slower.startTime) {
                if mid == nil, r.progress > 0.5 { mid = r }
                last = r
            }
        }
        let expected = slower.time - ref.time
        XCTAssertEqual(last?.delta ?? 0, expected, accuracy: 0.3)
        XCTAssertEqual(last?.predictedLap ?? 0, slower.time, accuracy: 0.3)
        XCTAssertEqual(mid?.delta ?? 0, expected / 2, accuracy: 0.3)
        XCTAssertGreaterThan(mid?.trend ?? 0, 0) // losing time continuously
    }

    func testCornerDetectionAndComparison() {
        let refLap = laps(slow: 1.0)[0]
        let ref = ReferenceLap(lap: refLap, projection: Stadium.projection)
        let corners = LapAnalysis.detectCorners(in: ref)
        XCTAssertEqual(corners.count, 2)
        XCTAssertTrue(corners.allSatisfy { $0.direction == .right })

        let slower = laps(slow: 1.1)[0]
        let comps = LapAnalysis.compare(slower, reference: ref)
        XCTAssertEqual(comps.count, 2)
        XCTAssertTrue(comps.allSatisfy { $0.timeLoss > 0 })
        XCTAssertTrue(comps.allSatisfy { $0.lap.minSpeed < $0.reference.minSpeed })
    }

    func testIdealLineUsesFastestSegments() {
        let a = laps(slow: 1.0)[0]
        var b = laps(slow: 1.1)[0]
        b.number = 2
        let ref = ReferenceLap(lap: a, projection: Stadium.projection)
        let ideal = LapAnalysis.idealLine(laps: [a, b], reference: ref)
        XCTAssertFalse(ideal.path.isEmpty)
        XCTAssertTrue(ideal.sources.allSatisfy { $0 == a.number })
    }
}

final class FusionTests: XCTestCase {
    func testFusionReducesGPSNoise() {
        var rng = SystemRandomNumberGenerator()
        func gauss(_ sigma: Double) -> Double {
            let u1 = Double.random(in: 1e-9..<1, using: &rng), u2 = Double.random(in: 0..<1, using: &rng)
            return sigma * (-2 * log(u1)).squareRoot() * cos(2 * .pi * u2)
        }
        let proj = Stadium.projection
        let fusion = SensorFusion(origin: proj.origin)
        let v = 30.0 // m/s due east
        var rawErr = 0.0, fusedErr = 0.0, n = 0.0
        for i in 0..<300 { // 30 s of 10 Hz GPS with 3 m noise, IMU at 100 Hz
            let t = Double(i) / 10
            for k in 1...9 { fusion.ingestIMU(t: t + Double(k) / 100 - 0.1, accelEN: .zero) }
            let truth = Vec2(v * t, 0)
            let noisy = truth + Vec2(gauss(3), gauss(3))
            let out = fusion.ingestGPS(.init(
                t: t, position: proj.toGeo(noisy), speed: v + gauss(0.2), course: 90 + gauss(0.5),
                horizontalAccuracy: 3, speedAccuracy: 0.2
            ))
            if i > 30 {
                rawErr += (noisy - truth).length
                fusedErr += (proj.toLocal(out.position) - truth).length
                n += 1
            }
        }
        XCTAssertLessThan(fusedErr / n, rawErr / n * 0.6)
    }

    func testImuAlignerRecoversMountYaw() {
        let aligner = ImuAligner()
        let theta = Geo.deg2rad(37)
        var vel = Vec2(20, 0)
        // Alternate braking / accelerating / cornering at 10 Hz GPS, 100 Hz IMU.
        for i in 1...400 {
            let t = Double(i) / 10
            let aEN = Vec2(3 * sin(t * 0.7), 4 * cos(t * 0.45))
            // IMU frame = EN rotated by -theta
            let c = cos(-theta), s = sin(-theta)
            let aIMU = Vec2(aEN.x * c - aEN.y * s, aEN.x * s + aEN.y * c)
            for _ in 0..<10 { aligner.addIMU(aIMU) }
            vel = vel + aEN * 0.1
            aligner.addGPSVelocity(t: t, velocity: vel)
        }
        XCTAssertEqual(Geo.rad2deg(aligner.theta ?? 0), 37, accuracy: 3)
        XCTAssertGreaterThan(aligner.confidence, 0.9)
    }
}

final class ParserTests: XCTestCase {
    func testNMEARMC() {
        let p = NMEAParser()
        let fixes = p.push("$GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,003.1,W*6A\r\n")
        XCTAssertEqual(fixes.count, 1)
        let f = fixes[0]
        XCTAssertEqual(f.position.lat, 48.1173, accuracy: 1e-4)
        XCTAssertEqual(f.position.lon, 11.516667, accuracy: 1e-5)
        XCTAssertEqual(f.speed, 22.4 * 0.514444, accuracy: 1e-3)
        XCTAssertEqual(f.course, 84.4, accuracy: 1e-9)
        XCTAssertEqual(f.utcSecondsOfDay, 12 * 3600 + 35 * 60 + 19, accuracy: 1e-9)
    }

    func testNMEARejectsBadChecksumAndHandlesChunks() {
        let p = NMEAParser()
        XCTAssertTrue(p.push("$GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,003.1,W*6B\n").isEmpty)
        XCTAssertTrue(p.push("$GPRMC,123519,A,4807.038,N,0113").isEmpty)
        XCTAssertEqual(p.push("1.000,E,022.4,084.4,230394,003.1,W*6A\n").count, 1)
    }

    func testRaceBoxFrame() {
        var payload = [UInt8](repeating: 0, count: 80)
        func put32(_ v: Int32, _ o: Int) { withUnsafeBytes(of: v.littleEndian) { for (i, b) in $0.enumerated() { payload[o + i] = b } } }
        func put16(_ v: UInt16, _ o: Int) { payload[o] = UInt8(v & 0xFF); payload[o + 1] = UInt8(v >> 8) }
        put16(2026, 4); payload[6] = 9; payload[7] = 27; payload[8] = 10; payload[9] = 30; payload[10] = 5
        payload[11] = 0x07; payload[20] = 3; payload[21] = 0x01; payload[23] = 14
        put32(164_444_000, 24) // lon 16.4444
        put32(492_031_000, 28) // lat 49.2031
        put32(250_000, 36)     // 250 m MSL
        put32(800, 40)         // 0.8 m
        put32(33_330, 48)      // 33.33 m/s
        put32(9_000_000, 52)   // 90°
        payload[67] = 87
        put16(UInt16(bitPattern: -1200), 68) // -1.2 g braking

        var packet: [UInt8] = [0xB5, 0x62, 0xFF, 0x01, 80, 0] + payload
        var a: UInt8 = 0, b: UInt8 = 0
        for x in packet[2...] { a = a &+ x; b = b &+ a }
        packet += [a, b]

        let parser = RaceBoxParser()
        // garbage + split delivery
        XCTAssertTrue(parser.push(Data([0x00, 0x13] + packet[0..<40])).isEmpty)
        let frames = parser.push(Data(packet[40...]))
        XCTAssertEqual(frames.count, 1)
        let f = frames[0]
        XCTAssertEqual(f.position.lat, 49.2031, accuracy: 1e-7)
        XCTAssertEqual(f.position.lon, 16.4444, accuracy: 1e-7)
        XCTAssertEqual(f.speed, 33.33, accuracy: 1e-6)
        XCTAssertEqual(f.heading, 90, accuracy: 1e-6)
        XCTAssertEqual(f.gX, -1.2, accuracy: 1e-6)
        XCTAssertEqual(f.satellites, 14)
        XCTAssertEqual(f.batteryPercent, 87)
        XCTAssertNotNil(f.date)
    }

    func testGPMFGPS5() {
        func klv(_ key: String, _ type: Character, _ size: Int, _ rep: Int, _ body: [UInt8]) -> [UInt8] {
            var out = Array(key.utf8) + [type.asciiValue ?? 0, UInt8(size), UInt8(rep >> 8), UInt8(rep & 0xFF)] + body
            while out.count % 4 != 0 { out.append(0) }
            return out
        }
        func be32(_ v: Int32) -> [UInt8] {
            let u = UInt32(bitPattern: v)
            return [UInt8(u >> 24), UInt8((u >> 16) & 0xFF), UInt8((u >> 8) & 0xFF), UInt8(u & 0xFF)]
        }
        let scal = klv("SCAL", "l", 4, 5, [10_000_000, 10_000_000, 1000, 1000, 100].flatMap { be32($0) })
        let gpsf = klv("GPSF", "L", 4, 1, be32(3))
        let gpsu = klv("GPSU", "U", 16, 1, Array("260927103005.000".utf8))
        var pts: [UInt8] = []
        for i in 0..<2 {
            pts += be32(492_031_000 + Int32(i * 10)) + be32(164_444_000) + be32(250_000) + be32(30_000) + be32(3000)
        }
        let gps5 = klv("GPS5", "l", 20, 2, pts)
        let strmBody = scal + gpsf + gpsu + gps5
        let strm = klv("STRM", "\0", 1, strmBody.count, strmBody)
        let devc = klv("DEVC", "\0", 1, strm.count, strm)

        let out = GPMFParser.gps(from: devc, sampleStart: 10, sampleDuration: 1)
        XCTAssertEqual(out.count, 2)
        XCTAssertEqual(out[0].position.lat, 49.2031, accuracy: 1e-7)
        XCTAssertEqual(out[0].speed, 30, accuracy: 1e-9)
        XCTAssertEqual(out[1].videoTime, 10.5, accuracy: 1e-9)
        XCTAssertNotNil(out[0].utc)
    }
}

final class VideoSyncTests: XCTestCase {
    func testSpeedCorrelationFindsOffset() {
        // Session speed trace with braking zones; video starts 42.37 s into the session.
        func speed(_ t: Double) -> Double { 30 + 12 * sin(t / 4) + 6 * sin(t / 1.7) }
        let session = stride(from: 0.0, to: 400, by: 0.1).map { (t: $0, v: speed($0)) }
        let trueOffset = 42.37
        let video = stride(from: 0.0, to: 200, by: 0.1).map { (t: $0, v: speed($0 + trueOffset)) }
        let r = VideoSync.correlate(video: video, session: session)
        XCTAssertNotNil(r)
        XCTAssertEqual(r?.offset ?? 0, trueOffset, accuracy: 0.06)
        XCTAssertGreaterThan(r?.confidence ?? 0, 0.95)
    }
}

final class CoachTests: XCTestCase {
    func testStreamDecoding() {
        XCTAssertEqual(
            ClaudeAPI.decode(dataLine: #"{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Brake later"}}"#),
            .text("Brake later")
        )
        XCTAssertNil(ClaudeAPI.decode(dataLine: #"{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":""}}"#))
        XCTAssertEqual(
            ClaudeAPI.decode(dataLine: #"{"type":"message_delta","delta":{"stop_reason":"end_turn"}}"#),
            .stop(reason: "end_turn")
        )
    }

    func testRequestBody() throws {
        let body = ClaudeAPI.requestBody(system: "sys", messages: [.init(role: "user", content: "hi")])
        let obj = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
        XCTAssertEqual(obj["model"] as? String, "claude-opus-5")
        XCTAssertEqual(obj["stream"] as? Bool, true)
        XCTAssertEqual((obj["thinking"] as? [String: Any])?["type"] as? String, "adaptive")
    }

    func testDebriefPromptContainsCornerData() {
        let timer = LapTimer(track: Stadium.track)
        for s in Stadium.drive(laps: 2) { timer.ingest(s) }
        let ref = ReferenceLap(lap: timer.laps[0], projection: Stadium.projection)
        let session = Session(trackID: "stadium", trackName: "Stadium", startDate: Date(), laps: timer.laps)
        let comps = LapAnalysis.compare(timer.laps[1], reference: ref)
        let prompt = CoachPrompts.debrief(
            track: Stadium.track, vehicle: nil, session: session, reference: ref,
            compareLap: timer.laps[1], comparisons: comps
        )
        XCTAssertTrue(prompt.contains("\"corner\":\"T1\""))
        XCTAssertTrue(prompt.contains("timeLoss_s"))
    }
}
