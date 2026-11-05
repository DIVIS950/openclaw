import SwiftUI

/// Big pill slider in the style of Control Center. Drag anywhere on it; it sends
/// values at most every 0.3 s while dragging and always sends the final value.
@MainActor
struct LevelSlider: View {
    let value: Double
    let tint: Color
    let icon: String
    let label: String
    var height: CGFloat = 54
    var valueText: (Double) -> String = { $0.percentText }
    let onChange: (Double) -> Void

    @State private var dragValue: Double?
    @State private var lastSent = Date.distantPast

    var body: some View {
        GeometryReader { geo in
            let shown = dragValue ?? value
            ZStack(alignment: .leading) {
                Rectangle().fill(.white.opacity(0.08))
                Rectangle()
                    .fill(tint.gradient)
                    .frame(width: max(0, geo.size.width * shown))
                    .animation(dragValue == nil ? .easeOut(duration: 0.25) : nil, value: shown)
                HStack(spacing: 10) {
                    Image(systemName: icon).font(.body.weight(.semibold))
                    Text(label).lineLimit(1)
                    Spacer(minLength: 8)
                    Text(valueText(shown)).monospacedDigit()
                }
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.white)
                .shadow(color: .black.opacity(0.35), radius: 2)
                .padding(.horizontal, 16)
            }
            .clipShape(RoundedRectangle(cornerRadius: Theme.smallCorner, style: .continuous))
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 6)
                    .onChanged { gesture in
                        // Leave mostly-vertical swipes alone so the page can still scroll.
                        if dragValue == nil && abs(gesture.translation.height) > abs(gesture.translation.width) { return }
                        let v = Double(gesture.location.x / max(1, geo.size.width)).clamped01
                        dragValue = v
                        if Date().timeIntervalSince(lastSent) > 0.3 {
                            lastSent = Date()
                            onChange(v)
                        }
                    }
                    .onEnded { gesture in
                        guard dragValue != nil else { return }
                        let v = Double(gesture.location.x / max(1, geo.size.width)).clamped01
                        onChange(v)
                        dragValue = nil
                    }
            )
            .onTapGesture { location in
                onChange(Double(location.x / max(1, geo.size.width)).clamped01)
            }
        }
        .frame(height: height)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
        .accessibilityValue(valueText(value))
        .accessibilityAdjustableAction { direction in
            switch direction {
            case .increment: onChange((value + 0.1).clamped01)
            case .decrement: onChange((value - 0.1).clamped01)
            @unknown default: break
            }
        }
    }
}

/// Round icon button used for power / toggle actions.
@MainActor
struct CircleButton: View {
    let icon: String
    var isOn: Bool = false
    var tint: Color = .white
    var size: CGFloat = 54
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: size * 0.38, weight: .semibold))
                .foregroundStyle(isOn ? .black : .white)
                .frame(width: size, height: size)
                .background(isOn ? AnyShapeStyle(tint.gradient) : AnyShapeStyle(.white.opacity(0.10)), in: Circle())
        }
        .buttonStyle(PressableStyle())
    }
}

/// Slight shrink on press, like the Crestron Home tiles.
struct PressableStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.95 : 1)
            .opacity(configuration.isPressed ? 0.85 : 1)
            .animation(.easeOut(duration: 0.15), value: configuration.isPressed)
    }
}

@MainActor
struct StatusChip: View {
    let icon: String
    let text: String
    var tint: Color = .white

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: icon).foregroundStyle(tint)
            Text(text).lineLimit(1)
        }
        .font(.subheadline.weight(.medium))
        .padding(.horizontal, 14)
        .padding(.vertical, 9)
        .background(.ultraThinMaterial, in: Capsule())
    }
}
