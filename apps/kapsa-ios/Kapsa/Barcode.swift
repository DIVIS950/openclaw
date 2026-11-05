import CoreImage
import CoreImage.CIFilterBuiltins
import SwiftUI
import UIKit

/// Draws card codes. Code 128, QR, PDF417 and Aztec come from Core Image; EAN-13,
/// EAN-8, UPC-A and Code 39 (which Core Image can't make) are encoded here.
@MainActor
enum Barcodes {
    private static let context = CIContext()
    private static var cache: [String: UIImage] = [:]

    // MARK: Guessing and checking

    /// GS1 check digit for the digits given (without the check digit).
    nonisolated static func checkDigit(_ body: String) -> Int {
        var sum = 0
        for (i, ch) in body.reversed().enumerated() {
            let d = ch.wholeNumberValue ?? 0
            sum += i % 2 == 0 ? d * 3 : d
        }
        return (10 - sum % 10) % 10
    }

    nonisolated static func isAsciiDigits(_ s: String) -> Bool {
        !s.isEmpty && s.allSatisfy { $0.isASCII && $0.isNumber }
    }

    nonisolated static func validGS1(_ s: String) -> Bool {
        guard isAsciiDigits(s), s.count >= 8 else { return false }
        return checkDigit(String(s.dropLast())) == s.last?.wholeNumberValue
    }

    /// Best format for a typed number: shop EAN codes when the check digit fits.
    nonisolated static func guess(_ code: String) -> BarcodeFormat {
        let c = code.trimmingCharacters(in: .whitespaces)
        if c.isEmpty { return .none }
        if c.count == 13, validGS1(c) { return .ean13 }
        if c.count == 8, validGS1(c) { return .ean8 }
        if c.count == 12, validGS1(c) { return .upca }
        return .code128
    }

    /// "2 990047 182631" style grouping for reading the number out loud.
    nonisolated static func grouped(_ code: String, _ format: BarcodeFormat) -> String {
        let c = Array(code)
        func part(_ a: Int, _ b: Int) -> String { String(c[a..<b]) }
        switch format {
        case .ean13 where c.count == 13:
            return "\(part(0, 1)) \(part(1, 7)) \(part(7, 13))"
        case .ean8 where c.count == 8:
            return "\(part(0, 4)) \(part(4, 8))"
        case .upca where c.count == 12:
            return "\(part(0, 1)) \(part(1, 6)) \(part(6, 11)) \(part(11, 12))"
        default:
            guard c.count > 8, !code.contains(" ") else { return code }
            return stride(from: 0, to: c.count, by: 4).map { part($0, min($0 + 4, c.count)) }.joined(separator: " ")
        }
    }

    // MARK: Encoders

    private nonisolated static let lCodes = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"]
    private nonisolated static let gCodes = ["0100111", "0110011", "0011011", "0100001", "0011101", "0111001", "0000101", "0010001", "0001001", "0010111"]
    private nonisolated static let rCodes = ["1110010", "1100110", "1101100", "1000010", "1011100", "1001110", "1010000", "1000100", "1001000", "1110100"]
    private nonisolated static let parity = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"]

    /// EAN-13 bars (95 modules). Accepts 12 digits (adds the check digit) or 13.
    nonisolated static func ean13(_ code: String) -> [Bool]? {
        guard isAsciiDigits(code), code.count == 12 || code.count == 13 else { return nil }
        let full = code.count == 12 ? code + String(checkDigit(code)) : code
        guard validGS1(full) else { return nil }
        let d = full.compactMap(\.wholeNumberValue)
        var bits = "101"
        let pattern = Array(parity[d[0]])
        for i in 1...6 {
            bits += pattern[i - 1] == "L" ? lCodes[d[i]] : gCodes[d[i]]
        }
        bits += "01010"
        for i in 7...12 {
            bits += rCodes[d[i]]
        }
        bits += "101"
        return bits.map { $0 == "1" }
    }

    /// EAN-8 bars (67 modules). Accepts 7 digits (adds the check digit) or 8.
    nonisolated static func ean8(_ code: String) -> [Bool]? {
        guard isAsciiDigits(code), code.count == 7 || code.count == 8 else { return nil }
        let full = code.count == 7 ? code + String(checkDigit(code)) : code
        guard validGS1(full) else { return nil }
        let d = full.compactMap(\.wholeNumberValue)
        var bits = "101"
        for i in 0..<4 { bits += lCodes[d[i]] }
        bits += "01010"
        for i in 4..<8 { bits += rCodes[d[i]] }
        bits += "101"
        return bits.map { $0 == "1" }
    }

    private nonisolated static let code39Table: [Character: String] = [
        "0": "000110100", "1": "100100001", "2": "001100001", "3": "101100000", "4": "000110001",
        "5": "100110000", "6": "001110000", "7": "000100101", "8": "100100100", "9": "001100100",
        "A": "100001001", "B": "001001001", "C": "101001000", "D": "000011001", "E": "100011000",
        "F": "001011000", "G": "000001101", "H": "100001100", "I": "001001100", "J": "000011100",
        "K": "100000011", "L": "001000011", "M": "101000010", "N": "000010011", "O": "100010010",
        "P": "001010010", "Q": "000000111", "R": "100000110", "S": "001000110", "T": "000010110",
        "U": "110000001", "V": "011000001", "W": "111000000", "X": "010010001", "Y": "110010000",
        "Z": "011010000", "-": "010000101", ".": "110000100", " ": "011000100", "*": "010010100",
        "$": "010101000", "/": "010100010", "+": "010001010", "%": "000101010",
    ]

    /// Code 39 bars: each character is 5 bars and 4 spaces, wide ones three modules.
    nonisolated static func code39(_ code: String) -> [Bool]? {
        let text = "*" + code.uppercased().replacingOccurrences(of: "*", with: "") + "*"
        var out: [Bool] = []
        for ch in text {
            guard let pattern = code39Table[ch] else { return nil }
            for (i, w) in pattern.enumerated() {
                let isBar = i % 2 == 0
                out += Array(repeating: isBar, count: w == "1" ? 3 : 1)
            }
            out.append(false)
        }
        return out
    }

    // MARK: Images

    /// The code as a crisp black-on-white picture (1 point per module; scale with `.interpolation(.none)`).
    static func image(code: String, format: BarcodeFormat) -> UIImage? {
        let trimmed = code.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty, format != .none else { return nil }
        let key = "\(format.rawValue)|\(trimmed)"
        if let hit = cache[key] { return hit }
        let made: UIImage?
        switch format {
        case .ean13:
            made = bars(ean13(trimmed)) ?? coreImage(trimmed, .code128)
        case .upca:
            made = bars(ean13("0" + trimmed)) ?? coreImage(trimmed, .code128)
        case .ean8:
            made = bars(ean8(trimmed)) ?? coreImage(trimmed, .code128)
        case .code39:
            made = bars(code39(trimmed)) ?? coreImage(trimmed, .code128)
        default:
            made = coreImage(trimmed, format)
        }
        if let made {
            cache[key] = made
        }
        return made
    }

    private static func bars(_ modules: [Bool]?) -> UIImage? {
        guard let modules, !modules.isEmpty else { return nil }
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        let size = CGSize(width: modules.count, height: 1)
        return UIGraphicsImageRenderer(size: size, format: format).image { ctx in
            UIColor.white.setFill()
            ctx.fill(CGRect(origin: .zero, size: size))
            UIColor.black.setFill()
            for (x, on) in modules.enumerated() where on {
                ctx.fill(CGRect(x: x, y: 0, width: 1, height: 1))
            }
        }
    }

    private static func coreImage(_ code: String, _ format: BarcodeFormat) -> UIImage? {
        let utf8 = Data(code.utf8)
        let output: CIImage?
        switch format {
        case .qr:
            let f = CIFilter.qrCodeGenerator()
            f.message = utf8
            f.correctionLevel = "M"
            output = f.outputImage
        case .pdf417:
            let f = CIFilter.pdf417BarcodeGenerator()
            f.message = utf8
            output = f.outputImage
        case .aztec:
            let f = CIFilter.aztecCodeGenerator()
            f.message = utf8
            output = f.outputImage
        default:
            guard let ascii = code.data(using: .ascii) else { return nil }
            let f = CIFilter.code128BarcodeGenerator()
            f.message = ascii
            f.quietSpace = 0
            output = f.outputImage
        }
        guard let output, let cg = context.createCGImage(output, from: output.extent) else { return nil }
        return UIImage(cgImage: cg)
    }
}

/// The scannable code, sized for the till: wide for bar codes, square for QR.
struct BarcodeView: View {
    let code: String
    let format: BarcodeFormat
    var height: CGFloat = 110

    var body: some View {
        if let image = Barcodes.image(code: code, format: format) {
            switch format {
            case .qr, .aztec:
                Image(uiImage: image)
                    .interpolation(.none)
                    .resizable()
                    .scaledToFit()
                    .frame(maxWidth: 220, maxHeight: 220)
                    .accessibilityLabel(Text(code))
            case .pdf417:
                Image(uiImage: image)
                    .interpolation(.none)
                    .resizable()
                    .scaledToFit()
                    .frame(maxHeight: height)
                    .accessibilityLabel(Text(code))
            default:
                Image(uiImage: image)
                    .interpolation(.none)
                    .resizable()
                    .frame(maxWidth: .infinity)
                    .frame(height: height)
                    .accessibilityLabel(Text(code))
            }
        } else {
            Text(L("Bez čárového kódu: ukaž číslo.", "No barcode: show the number."))
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, minHeight: 60)
        }
    }
}
