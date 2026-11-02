import SwiftUI
import UIKit
import UIKit.UIGestureRecognizerSubclass

// Small bits of motion for Home View: lights that glow with their level, a ring when a tile
// was just changed, the scene color ripple, and cards that lean toward the finger.
// Everything here stays still when Reduce Motion is on.

// MARK: - Light glow

/// The soft glow around a light's icon: bigger when the light is brighter, gently breathing.
struct HVLampGlow: ViewModifier {
    let color: Color
    /// 0 when the light is off.
    let level: Double
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @ViewBuilder
    func body(content: Content) -> some View {
        if level <= 0.005 {
            content
        } else if reduceMotion {
            content.shadow(color: color.opacity(0.55), radius: Self.radius(level, breath: 0))
        } else {
            content.phaseAnimator([false, true]) { view, up in
                view.shadow(color: color.opacity(up ? 0.72 : 0.5), radius: Self.radius(level, breath: up ? 1 : 0))
            } animation: { _ in
                .easeInOut(duration: 2)
            }
        }
    }

    private static func radius(_ level: Double, breath: Double) -> CGFloat {
        CGFloat(5 + 15 * level + 5 * level * breath)
    }
}

// MARK: - "Just changed" ring

/// A ring that bursts out of a tile's icon each time `trigger` changes.
struct HVRingBurst: View {
    let trigger: Int
    let color: Color
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        if !reduceMotion {
            Circle()
                .strokeBorder(color, lineWidth: 3)
                // 0 = resting (invisible); each change jumps to 1 and fades back to 0 as it grows.
                .keyframeAnimator(initialValue: 0.0, trigger: trigger) { ring, t in
                    ring
                        .scaleEffect(CGFloat(1 + 0.9 * (1 - t)))
                        .opacity(0.9 * t)
                } keyframes: { _ in
                    KeyframeTrack {
                        MoveKeyframe(1.0)
                        CubicKeyframe(0.0, duration: 0.7)
                    }
                }
                .allowsHitTesting(false)
                .accessibilityHidden(true)
        }
    }
}

// MARK: - Scene ripple

/// Draws `HVNav.ripple` over the whole screen.
struct HVRippleLayer: View {
    let ripple: HVNav.Ripple?

    var body: some View {
        GeometryReader { geo in
            if let ripple {
                let origin = geo.frame(in: .global).origin
                HVRippleDot(color: ripple.color)
                    .position(x: ripple.center.x - origin.x, y: ripple.center.y - origin.y)
                    .id(ripple.id)
            }
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

private struct HVRippleDot: View {
    let color: Color
    @State private var spread = false

    var body: some View {
        Circle()
            .fill(RadialGradient(colors: [color.opacity(0.45), color.opacity(0)], center: .center, startRadius: 0, endRadius: 20))
            .frame(width: 40, height: 40)
            .scaleEffect(spread ? 60 : 1)
            .opacity(spread ? 0 : 1)
            .onAppear { withAnimation(.easeOut(duration: 1)) { spread = true } }
    }
}

// MARK: - Tilt

extension View {
    /// Leans the card a few degrees toward where it is pressed (or where the pointer is).
    func hvTilt(_ maxAngle: Double = 3.5) -> some View { modifier(HVTilt(maxAngle: maxAngle)) }
}

/// The tilt follows a press. It watches touches without taking part in them (see
/// `HVTouchObserver`), so buttons, sliders, "slide to open" and scrolling work as before.
/// A touch that travels more than a few points is a scroll, swipe or slider drag: the card
/// then settles back.
struct HVTilt: ViewModifier {
    var maxAngle: Double
    /// -0.5...0.5 across the card; zero when nothing presses it.
    @State private var lean = CGSize.zero
    @State private var pressed = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @ViewBuilder
    func body(content: Content) -> some View {
        if reduceMotion {
            content
        } else {
            content
                .rotation3DEffect(.degrees(Double(-lean.height) * maxAngle * 2), axis: (x: 1, y: 0, z: 0), perspective: 0.5)
                .rotation3DEffect(.degrees(Double(lean.width) * maxAngle * 2), axis: (x: 0, y: 1, z: 0), perspective: 0.5)
                .animation(pressed ? .linear(duration: 0.08) : .spring(response: 0.5, dampingFraction: 0.7), value: lean)
                // Outside the rotation, so the watched area stays the card's real frame.
                .background(HVTouchObserver { point in
                    if let point {
                        pressed = true
                        lean = CGSize(width: point.x - 0.5, height: point.y - 0.5)
                    } else {
                        pressed = false
                        lean = .zero
                    }
                })
        }
    }
}

/// Reports where a finger is pressing inside this view, as a unit point (0...1 on both
/// axes), and nil when it lifts, moves away or turns into a scroll.
struct HVTouchObserver: UIViewRepresentable {
    let onChange: (CGPoint?) -> Void

    func makeUIView(context: Context) -> HVTouchObserverView {
        let view = HVTouchObserverView()
        view.onChange = onChange
        return view
    }

    func updateUIView(_ uiView: HVTouchObserverView, context: Context) {
        uiView.onChange = onChange
    }

    static func dismantleUIView(_ uiView: HVTouchObserverView, coordinator: ()) {
        uiView.detach()
    }
}

/// An invisible view that puts a watching gesture recognizer on its window. The recognizer
/// never recognizes and never cancels or delays touches, so it changes nothing for the
/// controls underneath; it only reports touches that start inside this view.
final class HVTouchObserverView: UIView {
    var onChange: ((CGPoint?) -> Void)?
    private var watcher: HVTouchWatcher?

    override init(frame: CGRect) {
        super.init(frame: frame)
        isUserInteractionEnabled = false
        backgroundColor = .clear
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not used")
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        detach()
        guard let window else { return }
        let watcher = HVTouchWatcher(target: nil, action: nil)
        watcher.owner = self
        watcher.cancelsTouchesInView = false
        watcher.delaysTouchesBegan = false
        watcher.delaysTouchesEnded = false
        window.addGestureRecognizer(watcher)
        self.watcher = watcher
    }

    func detach() {
        if let watcher { watcher.view?.removeGestureRecognizer(watcher) }
        watcher = nil
    }

    fileprivate func report(_ touch: UITouch?) {
        guard let touch else {
            onChange?(nil)
            return
        }
        let size = bounds.size
        guard size.width > 1, size.height > 1 else { return }
        let p = touch.location(in: self)
        onChange?(CGPoint(x: min(max(p.x / size.width, 0), 1), y: min(max(p.y / size.height, 0), 1)))
    }
}

/// Follows one touch that began inside its owner's frame.
private final class HVTouchWatcher: UIGestureRecognizer {
    weak var owner: HVTouchObserverView?
    private var tracked: UITouch?
    private var start = CGPoint.zero

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
        super.touchesBegan(touches, with: event)
        guard tracked == nil, let owner, owner.window != nil, !owner.isHidden else { return }
        for touch in touches {
            let p = touch.location(in: owner)
            if owner.bounds.contains(p) {
                tracked = touch
                start = touch.location(in: nil)
                owner.report(touch)
                return
            }
        }
    }

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent) {
        super.touchesMoved(touches, with: event)
        guard let tracked, touches.contains(tracked) else { return }
        let now = tracked.location(in: nil)
        if hypot(now.x - start.x, now.y - start.y) > 12 {
            // A scroll, a page swipe or a slider: stop leaning.
            finish()
        } else {
            owner?.report(tracked)
        }
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent) {
        super.touchesEnded(touches, with: event)
        if let tracked, touches.contains(tracked) { finish() }
        if event.allTouches?.allSatisfy({ $0.phase == .ended || $0.phase == .cancelled }) ?? true { state = .failed }
    }

    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent) {
        super.touchesCancelled(touches, with: event)
        if let tracked, touches.contains(tracked) { finish() }
        state = .failed
    }

    override func reset() {
        super.reset()
        finish()
    }

    private func finish() {
        guard tracked != nil else { return }
        tracked = nil
        owner?.report(nil)
    }
}
