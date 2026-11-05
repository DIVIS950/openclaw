import SwiftUI
import UIKit
import Vision
import VisionKit

/// A code read by the camera or from a photo.
struct ScannedCode: Equatable, Sendable {
    let value: String
    let format: BarcodeFormat
}

@MainActor
enum CodeReader {
    /// Our format for what Vision found (UPC-A arrives as EAN-13 with a leading 0).
    static func format(for symbology: VNBarcodeSymbology) -> BarcodeFormat {
        switch symbology {
        case .ean13: .ean13
        case .ean8: .ean8
        case .code39, .code39Checksum, .code39FullASCII, .code39FullASCIIChecksum: .code39
        case .qr: .qr
        case .pdf417: .pdf417
        case .aztec: .aztec
        default: .code128
        }
    }

    /// Find a code in a photo (screenshot of an app card, photo of a plastic card).
    static func read(from image: UIImage) -> ScannedCode? {
        guard let cg = image.cgImage else { return nil }
        let request = VNDetectBarcodesRequest()
        let handler = VNImageRequestHandler(cgImage: cg, options: [:])
        do {
            try handler.perform([request])
        } catch {
            return nil
        }
        guard let best = request.results?.first(where: { $0.payloadStringValue?.isEmpty == false }),
              let value = best.payloadStringValue
        else { return nil }
        return ScannedCode(value: value, format: format(for: best.symbology))
    }

    /// The live scanner needs a recent iPhone (A12 chip or newer) and camera access.
    static var liveScannerWorks: Bool {
        DataScannerViewController.isSupported && DataScannerViewController.isAvailable
    }
}

/// Apple's live barcode scanner, wrapped for SwiftUI. Calls `onCode` once.
struct LiveScanner: UIViewControllerRepresentable {
    let onCode: (ScannedCode) -> Void

    func makeUIViewController(context: Context) -> DataScannerViewController {
        let scanner = DataScannerViewController(
            recognizedDataTypes: [.barcode()],
            qualityLevel: .balanced,
            recognizesMultipleItems: false,
            isHighFrameRateTrackingEnabled: false,
            isPinchToZoomEnabled: true,
            isGuidanceEnabled: true,
            isHighlightingEnabled: true
        )
        scanner.delegate = context.coordinator
        return scanner
    }

    func updateUIViewController(_ scanner: DataScannerViewController, context: Context) {
        if !scanner.isScanning {
            try? scanner.startScanning()
        }
    }

    static func dismantleUIViewController(_ scanner: DataScannerViewController, coordinator: Coordinator) {
        scanner.stopScanning()
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(onCode: onCode)
    }

    final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        let onCode: (ScannedCode) -> Void
        private var done = false

        init(onCode: @escaping (ScannedCode) -> Void) {
            self.onCode = onCode
        }

        func dataScanner(_ dataScanner: DataScannerViewController, didAdd addedItems: [RecognizedItem], allItems: [RecognizedItem]) {
            guard !done else { return }
            for item in addedItems {
                if case let .barcode(barcode) = item, let value = barcode.payloadStringValue, !value.isEmpty {
                    done = true
                    UINotificationFeedbackGenerator().notificationOccurred(.success)
                    dataScanner.stopScanning()
                    onCode(ScannedCode(value: value, format: CodeReader.format(for: barcode.observation.symbology)))
                    return
                }
            }
        }
    }
}
