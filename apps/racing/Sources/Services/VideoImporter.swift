import AVFoundation
import CoreMedia
import Foundation
import RaceCore

/// Pulls the GPMF telemetry track out of a GoPro MP4 and aligns the video with a session.
enum VideoImporter {
    /// Reads every `gpmd` sample and decodes GPS points (video-relative time).
    static func goProGPS(url: URL) async throws -> [GPMFParser.GPSPoint] {
        let asset = AVURLAsset(url: url)
        let tracks = try await asset.loadTracks(withMediaType: .metadata)
        var gpmd: AVAssetTrack?
        for t in tracks {
            let fmts = try await t.load(.formatDescriptions)
            if fmts.contains(where: { CMFormatDescriptionGetMediaSubType($0) == fourCC("gpmd") }) {
                gpmd = t
                break
            }
        }
        guard let track = gpmd else { return [] }

        let reader = try AVAssetReader(asset: asset)
        let output = AVAssetReaderTrackOutput(track: track, outputSettings: nil)
        reader.add(output)
        guard reader.startReading() else { throw reader.error ?? CocoaError(.fileReadCorruptFile) }

        var points: [GPMFParser.GPSPoint] = []
        while let sb = output.copyNextSampleBuffer() {
            guard let block = CMSampleBufferGetDataBuffer(sb) else { continue }
            let len = CMBlockBufferGetDataLength(block)
            var bytes = [UInt8](repeating: 0, count: len)
            guard CMBlockBufferCopyDataBytes(block, atOffset: 0, dataLength: len, destination: &bytes) == noErr else { continue }
            let start = CMSampleBufferGetPresentationTimeStamp(sb).seconds
            var dur = CMSampleBufferGetDuration(sb).seconds
            if !dur.isFinite || dur <= 0 { dur = 1.001 }
            points += GPMFParser.gps(from: bytes, sampleStart: start, sampleDuration: dur)
        }
        return points
    }

    static func duration(url: URL) async -> Double {
        (try? await AVURLAsset(url: url).load(.duration).seconds) ?? 0
    }

    /// Best available alignment: speed correlation seeded by GPS UTC, else shutter timestamp.
    static func sync(session: Session, videoURL: URL, shutterStart: Date?) async -> VideoSync.Result? {
        let gps = (try? await goProGPS(url: videoURL)) ?? []
        let shutterSeed = shutterStart.map {
            // Camera takes ~0.3 s from command ack to first frame on HERO9-12.
            VideoSync.Result(offset: $0.timeIntervalSince(session.startDate) + 0.3, confidence: 0.5, method: .shutterTimestamp)
        }
        guard gps.count > 20 else { return shutterSeed }

        let seed = VideoSync.utcOffset(points: gps, sessionStart: session.startDate) ?? shutterSeed
        let video = gps.map { (t: $0.videoTime, v: $0.speed) }
        let sess = session.samples.map { (t: $0.t, v: $0.speed) }
        if let r = VideoSync.correlate(video: video, session: sess, seed: seed?.offset, window: seed == nil ? 3600 : 20),
           r.confidence > 0.6
        {
            return r
        }
        return seed
    }

    private static func fourCC(_ s: String) -> FourCharCode {
        s.utf8.reduce(0) { ($0 << 8) | FourCharCode($1) }
    }
}
