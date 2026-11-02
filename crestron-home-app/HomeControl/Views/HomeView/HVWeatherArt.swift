import Foundation
import SwiftUI

// Little drawings that move: the sky in the weather widget and the gate in the gate widget.
// They stand still when Reduce Motion is on.

// MARK: - Weather

/// Drawn, gently moving weather in a 120 × 104 box: a sun with turning rays, the moon and
/// twinkling stars, drifting clouds, falling rain or snow, a storm bolt and fog.
struct HVWeatherArt: View {
    enum Kind: Equatable {
        case sun, moon, cloudSun, cloudMoon, cloudy, rain, snow, storm, fog

        /// From the WMO weather code, like the symbols in `WeatherNow`.
        init(code: Int, isDay: Bool) {
            switch code {
            case 0: self = isDay ? .sun : .moon
            case 1, 2: self = isDay ? .cloudSun : .cloudMoon
            case 45, 48: self = .fog
            case 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82: self = .rain
            case 71, 73, 75, 77, 85, 86: self = .snow
            case 95, 96, 99: self = .storm
            default: self = .cloudy
            }
        }
    }

    let kind: Kind
    var night = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    static let size = CGSize(width: 120, height: 104)

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30, paused: reduceMotion)) { context in
            let t = reduceMotion ? 0 : context.date.timeIntervalSinceReferenceDate
            Canvas { ctx, _ in draw(in: &ctx, t: t) }
        }
        .frame(width: Self.size.width, height: Self.size.height)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    // The positions follow the web version (web/public/ipad/homeview.css, "weather drawings").
    private func draw(in ctx: inout GraphicsContext, t: Double) {
        switch kind {
        case .sun:
            sun(&ctx, center: CGPoint(x: 83, y: 31), radius: 23, t: t)
        case .moon:
            stars(&ctx, t: t)
            moon(&ctx, center: CGPoint(x: 78, y: 30), radius: 20)
        case .cloudSun:
            sun(&ctx, center: CGPoint(x: 62, y: 22), radius: 18, t: t)
            cloud(&ctx, x: 32, y: 40, width: 76, drift: drift(t, period: 7, offset: 0), scale: 1, opacity: 1)
        case .cloudMoon:
            stars(&ctx, t: t)
            moon(&ctx, center: CGPoint(x: 64, y: 22), radius: 16)
            cloud(&ctx, x: 32, y: 40, width: 76, drift: drift(t, period: 7, offset: 0), scale: 1, opacity: 1)
        case .cloudy:
            clouds(&ctx, t: t)
        case .rain:
            clouds(&ctx, t: t)
            drops(&ctx, t: t, count: 6, snow: false)
        case .snow:
            clouds(&ctx, t: t)
            drops(&ctx, t: t, count: 6, snow: true)
        case .storm:
            clouds(&ctx, t: t)
            bolt(&ctx, t: t)
            drops(&ctx, t: t, count: 4, snow: false)
        case .fog:
            fog(&ctx, t: t)
        }
    }

    /// Eased back-and-forth from -6 to +8 points, like CSS `alternate` with ease-in-out.
    private func drift(_ t: Double, period: Double, offset: Double) -> CGFloat {
        let phase = (t + offset).truncatingRemainder(dividingBy: period * 2) / period // 0..<2
        let linear = phase < 1 ? phase : 2 - phase
        let eased = (1 - cos(linear * Double.pi)) / 2
        return CGFloat(-6 + 14 * eased)
    }

    private func sun(_ ctx: inout GraphicsContext, center: CGPoint, radius r: CGFloat, t: Double) {
        let scale = r / 23
        // Warm halo.
        let halo = CGRect(x: center.x - r * 1.7, y: center.y - r * 1.7, width: r * 3.4, height: r * 3.4)
        ctx.fill(Path(ellipseIn: halo), with: .radialGradient(
            Gradient(colors: [Color(red: 1, green: 0.71, blue: 0.24).opacity(0.55), Color(red: 1, green: 0.71, blue: 0.24).opacity(0)]),
            center: center, startRadius: r * 0.8, endRadius: r * 1.7))
        // Twelve rays turning once every 24 seconds.
        let turn = t.truncatingRemainder(dividingBy: 24) / 24 * 2 * Double.pi
        var rays = Path()
        for i in 0..<12 {
            let a = Double(i) / 12 * 2 * Double.pi + turn
            let inner = 29 * scale, outer = 36 * scale
            rays.move(to: CGPoint(x: center.x + inner * CGFloat(cos(a)), y: center.y + inner * CGFloat(sin(a))))
            rays.addLine(to: CGPoint(x: center.x + outer * CGFloat(cos(a)), y: center.y + outer * CGFloat(sin(a))))
        }
        ctx.stroke(rays, with: .color(Color(red: 1, green: 0.77, blue: 0.27).opacity(0.8)), style: StrokeStyle(lineWidth: 3.5 * scale, lineCap: .round))
        // The disc.
        let disc = CGRect(x: center.x - r, y: center.y - r, width: r * 2, height: r * 2)
        ctx.fill(Path(ellipseIn: disc), with: .radialGradient(
            Gradient(stops: [
                .init(color: Color(red: 1, green: 0.89, blue: 0.48), location: 0.55),
                .init(color: Color(red: 1, green: 0.70, blue: 0.25), location: 1),
            ]),
            center: center, startRadius: 0, endRadius: r))
    }

    private func moon(_ ctx: inout GraphicsContext, center: CGPoint, radius r: CGFloat) {
        let disc = CGRect(x: center.x - r, y: center.y - r, width: r * 2, height: r * 2)
        ctx.drawLayer { glow in
            glow.addFilter(.shadow(color: Color(red: 0.86, green: 0.82, blue: 1).opacity(0.7), radius: 10))
            glow.drawLayer { crescent in
                crescent.fill(Path(ellipseIn: disc), with: .color(Color(red: 0.95, green: 0.94, blue: 1)))
                // Cut a circle off the upper left to leave a crescent.
                crescent.blendMode = .destinationOut
                crescent.fill(Path(ellipseIn: disc.offsetBy(dx: -r * 0.55, dy: -r * 0.38)), with: .color(.black))
            }
        }
    }

    private func stars(_ ctx: inout GraphicsContext, t: Double) {
        let spots: [(CGPoint, Double)] = [(CGPoint(x: 38, y: 18), 0), (CGPoint(x: 48, y: 48), 0.8), (CGPoint(x: 112, y: 62), 1.6)]
        for (point, delay) in spots {
            let phase = (t + delay).truncatingRemainder(dividingBy: 2.4) / 2.4
            let opacity = 0.25 + 0.75 * (0.5 + 0.5 * cos(phase * 2 * Double.pi))
            ctx.fill(Path(ellipseIn: CGRect(x: point.x - 2, y: point.y - 2, width: 4, height: 4)), with: .color(.white.opacity(opacity)))
        }
    }

    private func clouds(_ ctx: inout GraphicsContext, t: Double) {
        // The small one behind drifts the other way.
        cloud(&ctx, x: 6, y: 26, width: 56, drift: -drift(t, period: 9, offset: 0), scale: 0.8, opacity: 0.85)
        cloud(&ctx, x: 32, y: 40, width: 76, drift: drift(t, period: 7, offset: 0), scale: 1, opacity: 1)
    }

    /// A cloud: a pill with two puffs on top. `x`, `y`, `width` are the pill's frame.
    private func cloud(_ ctx: inout GraphicsContext, x: CGFloat, y: CGFloat, width: CGFloat, drift: CGFloat, scale: CGFloat, opacity: Double) {
        var shape = Path(roundedRect: CGRect(x: x, y: y, width: width, height: 26), cornerRadius: 13)
        shape.addEllipse(in: CGRect(x: x + 10, y: y - 14, width: 30, height: 30))
        shape.addEllipse(in: CGRect(x: x + 26, y: y - 20, width: 38, height: 38))
        // Scale around the pill's center, then drift sideways.
        let center = CGPoint(x: x + width / 2, y: y + 13)
        let transform = CGAffineTransform(translationX: center.x + drift, y: center.y)
            .scaledBy(x: scale, y: scale)
            .translatedBy(x: -center.x, y: -center.y)
        let color = night ? Color(red: 0.72, green: 0.74, blue: 0.84) : Color.white
        ctx.drawLayer { layer in
            layer.opacity = opacity
            layer.addFilter(.shadow(color: Color(red: 0.16, green: 0.24, blue: 0.4).opacity(0.18), radius: 7, x: 0, y: 6))
            layer.fill(shape.applying(transform), with: .color(color))
        }
    }

    private func drops(_ ctx: inout GraphicsContext, t: Double, count: Int, snow: Bool) {
        let xs: [CGFloat] = [33, 47, 61, 75, 89, 103]
        let delays: [Double] = [0, 0.3, 0.6, 0.15, 0.45, 0.75]
        let period = snow ? 2.2 : 0.9
        for i in 0..<min(count, xs.count) {
            // Snow uses the same rhythm, stretched to its slower fall.
            let phase = (t + delays[i] * period / 0.9).truncatingRemainder(dividingBy: period) / period
            let y = 66 + CGFloat(-6 + 28 * phase)
            let opacity = phase < 0.3 ? phase / 0.3 : (1 - phase) / 0.7
            if snow {
                ctx.fill(Path(ellipseIn: CGRect(x: xs[i] - 1.5, y: y, width: 6, height: 6)), with: .color(.white.opacity(opacity)))
            } else {
                ctx.fill(Path(roundedRect: CGRect(x: xs[i], y: y, width: 3, height: 12), cornerRadius: 1.5),
                         with: .color(Color(red: 0.35, green: 0.66, blue: 1).opacity(opacity)))
            }
        }
    }

    private func bolt(_ ctx: inout GraphicsContext, t: Double) {
        let phase = t.truncatingRemainder(dividingBy: 3) / 3
        let opacity = (0.08...0.14).contains(phase) ? 1.0 : 0.2
        let x: CGFloat = 62, y: CGFloat = 58, w: CGFloat = 14, h: CGFloat = 26
        let points: [(CGFloat, CGFloat)] = [(0.4, 0), (1, 0), (0.6, 0.45), (1, 0.45), (0.2, 1), (0.4, 0.55), (0, 0.55)]
        var path = Path()
        path.addLines(points.map { CGPoint(x: x + w * $0.0, y: y + h * $0.1) })
        path.closeSubpath()
        ctx.fill(path, with: .color(Color(red: 1, green: 0.82, blue: 0.25).opacity(opacity)))
    }

    private func fog(_ ctx: inout GraphicsContext, t: Double) {
        let bars: [(y: CGFloat, width: CGFloat, delay: Double)] = [(26, 90, 0), (44, 70, 2), (62, 96, 4)]
        for bar in bars {
            let x = Self.size.width - 10 - bar.width + drift(t, period: 6, offset: bar.delay)
            ctx.fill(Path(roundedRect: CGRect(x: x, y: bar.y, width: bar.width, height: 8), cornerRadius: 4),
                     with: .color(Color(red: 0.78, green: 0.82, blue: 0.88).opacity(0.85)))
        }
    }
}

// MARK: - Gate

/// A little gate between two posts. Its leaves swing open with the real gate and move back
/// and forth while it is moving.
struct HVGateArt: View {
    let state: GateState
    let color: Color
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Group {
            if state == .moving && !reduceMotion {
                PhaseAnimator([0.0, 60.0]) { angle in
                    leaves(angle)
                } animation: { _ in
                    .easeInOut(duration: 2.4)
                }
            } else {
                leaves(state == .open ? 72 : 0)
                    .animation(.timingCurve(0.4, 0, 0.2, 1, duration: 1.6), value: state)
            }
        }
        .frame(height: 44)
        .frame(maxWidth: .infinity)
        .accessibilityHidden(true)
    }

    private func leaves(_ angle: Double) -> some View {
        HStack(spacing: 0) {
            post
            leaf.rotation3DEffect(.degrees(-angle), axis: (x: 0, y: 1, z: 0), anchor: .leading, perspective: 0.4)
            leaf.rotation3DEffect(.degrees(angle), axis: (x: 0, y: 1, z: 0), anchor: .trailing, perspective: 0.4)
            post
        }
        .frame(maxWidth: 194)
    }

    private var post: some View {
        RoundedRectangle(cornerRadius: 3, style: .continuous)
            .fill(Color.primary.opacity(0.55))
            .frame(width: 7)
    }

    /// Bars every 13 points and two rails, drawn in the gate color.
    private var leaf: some View {
        let ink = color.opacity(0.75)
        return Canvas { ctx, size in
            var x: CGFloat = 0
            while x < size.width {
                ctx.fill(Path(CGRect(x: x, y: 0, width: 3, height: size.height)), with: .color(ink))
                x += 13
            }
            ctx.fill(Path(CGRect(x: size.width - 3, y: 0, width: 3, height: size.height)), with: .color(ink))
            for rail in [0.3, 0.75] {
                ctx.fill(Path(CGRect(x: 0, y: size.height * CGFloat(rail) - 1.5, width: size.width, height: 3)), with: .color(ink))
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 3, style: .continuous))
        .padding(.vertical, 6)
        .frame(maxWidth: 90)
    }
}
