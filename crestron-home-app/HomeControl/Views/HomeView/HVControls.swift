import SwiftUI

/// "slide to open": the knob has to travel almost all the way, so a stray tap does nothing.
/// VoiceOver can't slide, so its activate action asks for a confirmation instead.
@MainActor
struct HVSlideToOpen: View {
    let tint: Color
    let label: String
    let accessibilityName: String
    let onComplete: () -> Void
    let onAccessibilityOpen: () -> Void
    @State private var offset: CGFloat = 0
    @State private var shine = false

    private let knob: CGFloat = 50

    var body: some View {
        GeometryReader { geo in
            let maxX = max(1, geo.size.width - knob - 8)
            ZStack(alignment: .leading) {
                Capsule().fill(Color.primary.opacity(0.08))
                Capsule().fill(tint.opacity(0.28)).frame(width: offset + knob + 8)
                Text(label)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .overlay {
                        // A soft highlight sweeping across the words, like the old Lock Screen.
                        LinearGradient(colors: [.clear, .white.opacity(0.85), .clear], startPoint: .leading, endPoint: .trailing)
                            .frame(width: 70)
                            .offset(x: shine ? 120 : -120)
                            .mask(Text(label).font(.body.weight(.semibold)))
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.leading, 44)
                    .opacity(1 - Double(offset / maxX))
                Circle()
                    .fill(Color.white)
                    .frame(width: knob, height: knob)
                    .overlay(Image(systemName: "arrow.right").font(.system(size: 20, weight: .bold)).foregroundStyle(tint))
                    .shadow(color: .black.opacity(0.18), radius: 5, y: 2)
                    .offset(x: 4 + offset)
                    .gesture(
                        DragGesture()
                            .onChanged { value in offset = min(max(0, value.translation.width), maxX) }
                            .onEnded { _ in
                                if offset >= maxX * 0.85 {
                                    offset = maxX
                                    onComplete()
                                } else {
                                    withAnimation(.spring(response: 0.35, dampingFraction: 0.7)) { offset = 0 }
                                }
                            }
                    )
            }
        }
        .frame(height: 58)
        .onAppear { withAnimation(.linear(duration: 2.6).repeatForever(autoreverses: false)) { shine = true } }
        .accessibilityElement()
        .accessibilityLabel(accessibilityName)
        .accessibilityHint("Asks you to confirm")
        .accessibilityAddTraits(.isButton)
        .accessibilityAction { onAccessibilityOpen() }
    }
}

/// Control Center style slider: drag anywhere on it (relative to where you started),
/// or tap a spot to jump there.
@MainActor
struct HVBigSlider: View {
    enum Style { case light, shade, volume }

    let value: Double
    let style: Style
    let symbol: String
    let label: String
    let onChange: (Double) -> Void
    @State private var dragValue: Double?
    @State private var start = 0.0
    @State private var lastSent = Date.distantPast

    var body: some View {
        let shown = dragValue ?? value
        GeometryReader { geo in
            let height = max(1, geo.size.height)
            ZStack(alignment: .bottom) {
                track
                if style == .shade {
                    // A shade comes down from the top over a window of sky.
                    VStack(spacing: 0) {
                        fabric.frame(height: height * (1 - shown))
                        Spacer(minLength: 0)
                    }
                } else {
                    Rectangle().fill(fill).frame(height: height * shown)
                }
                Image(systemName: symbol)
                    .font(.system(size: 30, weight: .medium))
                    .foregroundStyle(iconColor(lit: shown > 0.04))
                    .padding(.bottom, 22)
            }
            .clipShape(RoundedRectangle(cornerRadius: 40, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 40, style: .continuous).strokeBorder(.white.opacity(0.3), lineWidth: 0.5))
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { drag in
                        if dragValue == nil { start = value }
                        let moved = abs(drag.translation.height) > 4
                        let next = moved ? (start - drag.translation.height / height).clamped01 : (dragValue ?? value)
                        dragValue = next
                        if moved, Date().timeIntervalSince(lastSent) > 0.22 {
                            lastSent = Date()
                            onChange(next)
                        }
                    }
                    .onEnded { drag in
                        var final = dragValue ?? value
                        if abs(drag.translation.height) <= 4 {
                            final = (((1 - drag.location.y / height) * 20).rounded() / 20).clamped01
                        }
                        onChange(final)
                        dragValue = nil
                    }
            )
            .animation(.easeOut(duration: 0.12), value: shown)
        }
        .frame(width: 136, height: 330)
        .accessibilityElement()
        .accessibilityLabel(label)
        .accessibilityValue(value.percentText)
        .accessibilityAdjustableAction { direction in
            switch direction {
            case .increment: onChange((value + 0.1).clamped01)
            case .decrement: onChange((value - 0.1).clamped01)
            @unknown default: break
            }
        }
    }

    @ViewBuilder
    private var track: some View {
        switch style {
        case .shade: LinearGradient(colors: [Color(red: 0.62, green: 0.82, blue: 1.0), Color(red: 0.87, green: 0.94, blue: 1.0), Color(red: 0.78, green: 0.9, blue: 0.75)], startPoint: .top, endPoint: .bottom)
        default: Rectangle().fill(Color.primary.opacity(0.14))
        }
    }

    private var fill: LinearGradient {
        switch style {
        case .volume: LinearGradient(colors: [Color(red: 0.70, green: 0.48, blue: 1.0), Color(red: 0.88, green: 0.79, blue: 1.0)], startPoint: .bottom, endPoint: .top)
        default: LinearGradient(colors: [HV.light, Color(red: 1.0, green: 0.85, blue: 0.42), Color(red: 1.0, green: 0.95, blue: 0.77)], startPoint: .bottom, endPoint: .top)
        }
    }

    private var fabric: some View {
        // Slats drawn with a repeating stripe.
        Canvas { context, size in
            context.fill(Path(CGRect(origin: .zero, size: size)), with: .color(Color(red: 0.91, green: 0.89, blue: 0.85)))
            var y: CGFloat = 16
            while y < size.height {
                context.fill(Path(CGRect(x: 0, y: y, width: size.width, height: 2)), with: .color(Color(red: 0.84, green: 0.81, blue: 0.75)))
                y += 18
            }
        }
        .shadow(color: .black.opacity(0.18), radius: 7, y: 6)
    }

    private func iconColor(lit: Bool) -> Color {
        switch style {
        case .shade: Color(red: 0.08, green: 0.2, blue: 0.35).opacity(0.7)
        case .light: lit ? Color(red: 0.24, green: 0.16, blue: 0).opacity(0.75) : .secondary
        case .volume: lit ? Color(red: 0.16, green: 0.04, blue: 0.31).opacity(0.7) : .secondary
        }
    }
}

/// Press and hold for a second; a ring fills while you hold.
@MainActor
struct HVHoldButton: View {
    let symbol: String
    let tint: Color
    let label: String
    let onComplete: () -> Void
    @State private var progress: CGFloat = 0

    var body: some View {
        ZStack {
            Circle().fill(tint.opacity(0.16))
            Circle()
                .trim(from: 0, to: progress)
                .stroke(Color.orange, style: StrokeStyle(lineWidth: 6, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .padding(-6)
            Image(systemName: symbol).font(.system(size: 44, weight: .medium)).foregroundStyle(tint)
        }
        .frame(width: 140, height: 140)
        .contentShape(Circle())
        .onLongPressGesture(minimumDuration: 1.0, maximumDistance: 40) {
            onComplete()
        } onPressingChanged: { pressing in
            withAnimation(pressing ? .linear(duration: 1.0) : .easeOut(duration: 0.2)) { progress = pressing ? 1 : 0 }
        }
        .accessibilityElement()
        .accessibilityLabel(label)
        .accessibilityAddTraits(.isButton)
        .accessibilityAction { onComplete() }
    }
}

/// The alarm keypad: round keys like the passcode screen.
@MainActor
struct HVKeypad: View {
    let actionTitle: String
    let onSubmit: (String) -> Void
    @State private var code = ""

    private let keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "delete"]

    var body: some View {
        VStack(spacing: 22) {
            HStack(spacing: 16) {
                ForEach(0..<max(4, code.count), id: \.self) { i in
                    Circle()
                        .strokeBorder(Color.primary, lineWidth: 1.6)
                        .background(Circle().fill(i < code.count ? Color.primary : Color.clear))
                        .frame(width: 14, height: 14)
                }
            }
            .accessibilityElement()
            .accessibilityLabel("\(code.count) digits entered")
            LazyVGrid(columns: Array(repeating: GridItem(.fixed(78), spacing: 24), count: 3), spacing: 16) {
                ForEach(keys, id: \.self) { key in
                    Button {
                        switch key {
                        case "clear": code = ""
                        case "delete": if !code.isEmpty { code.removeLast() }
                        default: if code.count < 10 { code.append(key) }
                        }
                    } label: {
                        Group {
                            switch key {
                            case "clear": Text("Clear").font(.body.weight(.medium))
                            case "delete": Image(systemName: "delete.left").font(.title2)
                            default: Text(key).font(.system(size: 32))
                            }
                        }
                        .foregroundStyle(.primary)
                        .frame(width: 78, height: 78)
                        .background(Circle().fill(key.count == 1 ? Color.primary.opacity(0.1) : .clear))
                        .contentShape(Circle())
                    }
                    .buttonStyle(HVPress())
                    .accessibilityLabel(key == "delete" ? "Delete" : key == "clear" ? "Clear" : key)
                }
            }
            HVWideButton(title: actionTitle, symbol: "checkmark.shield.fill", tint: .indigo, primary: true) {
                onSubmit(code)
            }
            .frame(maxWidth: 280)
            .disabled(code.isEmpty)
            .opacity(code.isEmpty ? 0.5 : 1)
        }
    }
}
