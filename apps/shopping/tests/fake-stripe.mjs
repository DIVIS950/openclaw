// Minimal stand-in for the Stripe PaymentIntents API, for local end-to-end tests.
// POST /__authorize/:id simulates the customer approving the payment.
import http from "node:http";

export function startFakeStripe(port = 12111) {
  const intents = new Map();
  let n = 0;
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const form = Object.fromEntries(new URLSearchParams(body));
      const send = (code, obj) => {
        res.writeHead(code, { "Content-Type": "application/json", "Request-Id": `req_${++n}` });
        res.end(JSON.stringify(obj));
      };
      const url = new URL(req.url, "http://x");
      let m;
      if (req.method === "POST" && url.pathname === "/v1/payment_intents") {
        const id = `pi_fake_${++n}`;
        const pi = { id, object: "payment_intent", amount: Number(form.amount), currency: form.currency, capture_method: form.capture_method, status: "requires_payment_method", amount_capturable: 0, amount_received: 0, client_secret: `${id}_secret_x`, metadata: { orderId: form["metadata[orderId]"] } };
        intents.set(id, pi);
        return send(200, pi);
      }
      if ((m = url.pathname.match(/^\/__authorize\/(.+)$/))) {
        const pi = intents.get(m[1]);
        if (!pi) return send(404, {});
        Object.assign(pi, { status: "requires_capture", amount_capturable: pi.amount });
        return send(200, pi);
      }
      if ((m = url.pathname.match(/^\/v1\/payment_intents\/([^/]+)(\/capture|\/cancel)?$/))) {
        const pi = intents.get(m[1]);
        if (!pi) return send(404, { error: { type: "invalid_request_error", message: "No such payment_intent" } });
        if (m[2] === "/capture") {
          if (pi.status !== "requires_capture") return send(400, { error: { type: "invalid_request_error", message: "Not capturable" } });
          const amt = form.amount_to_capture ? Number(form.amount_to_capture) : pi.amount;
          if (amt > pi.amount_capturable) return send(400, { error: { type: "invalid_request_error", message: "Amount too large" } });
          Object.assign(pi, { status: "succeeded", amount_received: amt, amount_capturable: 0 });
        } else if (m[2] === "/cancel") {
          Object.assign(pi, { status: "canceled", amount_capturable: 0 });
        }
        return send(200, pi);
      }
      send(404, { error: { type: "invalid_request_error", message: `Unhandled ${req.method} ${url.pathname}` } });
    });
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve({ server, intents })));
}
