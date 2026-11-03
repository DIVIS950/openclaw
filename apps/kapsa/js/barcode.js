// Barcode formats: names, check digits, mapping from the scanner and rendering.

/**
 * Formats the app can show. `bcid` is the bwip-js encoder, `detector` the names the
 * BarcodeDetector API reports, `linear` decides the layout of the code panel.
 */
export const FORMATS = {
  ean13: { label: "EAN-13", bcid: "ean13", detector: ["ean_13"], linear: true },
  ean8: { label: "EAN-8", bcid: "ean8", detector: ["ean_8"], linear: true },
  upca: { label: "UPC-A", bcid: "upca", detector: ["upc_a"], linear: true },
  upce: { label: "UPC-E", bcid: "upce", detector: ["upc_e"], linear: true },
  code128: { label: "Code 128", bcid: "code128", detector: ["code_128"], linear: true },
  code39: { label: "Code 39", bcid: "code39", detector: ["code_39"], linear: true },
  code93: { label: "Code 93", bcid: "code93", detector: ["code_93"], linear: true },
  itf: { label: "ITF", bcid: "interleaved2of5", detector: ["itf", "itf_14"], linear: true },
  codabar: { label: "Codabar", bcid: "rationalizedCodabar", detector: ["codabar"], linear: true },
  qr: { label: "QR", bcid: "qrcode", detector: ["qr_code", "micro_qr_code"], linear: false },
  pdf417: { label: "PDF417", bcid: "pdf417", detector: ["pdf417"], linear: false },
  aztec: { label: "Aztec", bcid: "azteccode", detector: ["aztec"], linear: false },
  datamatrix: { label: "Data Matrix", bcid: "datamatrix", detector: ["data_matrix"], linear: false },
  none: { label: "", bcid: null, detector: [], linear: true },
};

/** Order used in the format picker. */
export const FORMAT_ORDER = [
  "auto",
  "ean13",
  "code128",
  "qr",
  "ean8",
  "upca",
  "upce",
  "code39",
  "code93",
  "itf",
  "codabar",
  "pdf417",
  "aztec",
  "datamatrix",
  "none",
];

/**
 * Map a BarcodeDetector format name to ours.
 * @param {string} detectorFormat
 */
export function fromDetectorFormat(detectorFormat) {
  for (const [key, def] of Object.entries(FORMATS)) {
    if (def.detector.includes(detectorFormat)) {
      return key;
    }
  }
  return "code128";
}

/** Every detector format we can read. */
export function detectorFormats() {
  return Object.values(FORMATS).flatMap((f) => f.detector);
}

/**
 * GS1 mod-10 check digit for the digits before the check digit.
 * @param {string} body digits without the check digit
 */
export function gs1CheckDigit(body) {
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    const digit = body.charCodeAt(body.length - 1 - i) - 48;
    sum += i % 2 === 0 ? digit * 3 : digit;
  }
  return (10 - (sum % 10)) % 10;
}

/**
 * True when a full GS1 number (EAN-8, UPC-A, EAN-13) has a valid check digit.
 * @param {string} code
 */
export function isValidGs1(code) {
  if (!/^\d+$/.test(code) || code.length < 8) {
    return false;
  }
  return gs1CheckDigit(code.slice(0, -1)) === Number(code.at(-1));
}

/**
 * Pick a sensible format for a number typed by hand.
 * @param {string} code
 */
export function guessFormat(code) {
  const value = code.trim();
  if (!value) {
    return "none";
  }
  if (/^\d{13}$/.test(value) && isValidGs1(value)) {
    return "ean13";
  }
  if (/^\d{8}$/.test(value) && isValidGs1(value)) {
    return "ean8";
  }
  if (/^\d{12}$/.test(value) && isValidGs1(value)) {
    return "upca";
  }
  if (/^https?:\/\//i.test(value) || value.length > 48) {
    return "qr";
  }
  return "code128";
}

/**
 * Card numbers are easier to read in groups: "2 900123 456789", "1234 5678 9012".
 * @param {string} code
 * @param {string} format
 */
export function groupCode(code, format) {
  const value = code.trim();
  if (format === "ean13" && /^\d{13}$/.test(value)) {
    return `${value[0]} ${value.slice(1, 7)} ${value.slice(7)}`;
  }
  if (format === "ean8" && /^\d{8}$/.test(value)) {
    return `${value.slice(0, 4)} ${value.slice(4)}`;
  }
  if (/^\d{9,24}$/.test(value)) {
    return value.replace(/(\d{4})(?=\d)/g, "$1 ");
  }
  return value;
}

/**
 * Last characters of a number for the wallet ("•• 6789").
 * @param {string} code
 */
export function shortCode(code) {
  const value = code.replace(/\s+/g, "");
  if (!value) {
    return "";
  }
  if (value.length <= 6) {
    return value;
  }
  return `•• ${value.slice(-4)}`;
}

let bwipPromise = null;

/** Lazy-load the barcode renderer (it is the heaviest file in the app). */
function loadBwip() {
  bwipPromise ??= import("../vendor/bwip.js");
  return bwipPromise;
}

/**
 * Render a barcode to SVG markup. Falls back to Code 128 if a GS1 code has a bad
 * check digit, so a mistyped number still shows something scannable.
 * @param {string} code
 * @param {string} format
 * @returns {Promise<{ svg: string, format: string } | null>}
 */
export async function renderBarcodeSvg(code, format) {
  const value = code.trim();
  const def = FORMATS[format];
  if (!value || !def || !def.bcid) {
    return null;
  }
  const bwip = await loadBwip();
  const attempt = (fmt) => {
    const d = FORMATS[fmt];
    const opts = {
      bcid: d.bcid,
      text: value,
      scale: 3,
      includetext: false,
      paddingwidth: d.linear ? 10 : 2,
      paddingheight: 2,
      backgroundcolor: "FFFFFF",
    };
    if (d.linear) {
      opts.height = 22;
    }
    if (fmt === "pdf417") {
      opts.columns = 4;
    }
    return bwip[d.bcid](opts, bwip.drawingSVG());
  };
  try {
    return { svg: attempt(format), format };
  } catch {
    if (format !== "code128" && def.linear) {
      try {
        return { svg: attempt("code128"), format: "code128" };
      } catch {
        return null;
      }
    }
    return null;
  }
}
