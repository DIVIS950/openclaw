import assert from "node:assert/strict";
import { test } from "node:test";
import { formatPhone, normalizeCustomerPhone, normalizeCzechPhone } from "./phone";

test("accepts Czech landlines and mobiles in common formats", () => {
  assert.equal(normalizeCzechPhone("+420 222 333 444"), "+420222333444");
  assert.equal(normalizeCzechPhone("00420 777-123-456"), "+420777123456");
  assert.equal(normalizeCzechPhone("777 123 456"), "+420777123456");
  assert.equal(normalizeCzechPhone("420603123456"), "+420603123456");
  assert.equal(normalizeCzechPhone("(+420) 910 123 456"), "+420910123456");
});

test("rejects foreign, premium-rate, shared-cost and malformed numbers", () => {
  assert.equal(normalizeCzechPhone("+421 905 123 456"), null); // Slovakia
  assert.equal(normalizeCzechPhone("+44 20 7946 0958"), null);
  assert.equal(normalizeCzechPhone("+420 900 123 456"), null); // premium
  assert.equal(normalizeCzechPhone("+420 906 123 456"), null); // premium
  assert.equal(normalizeCzechPhone("+420 976 123 456"), null);
  assert.equal(normalizeCzechPhone("+420 800 123 456"), null); // free/shared-cost range
  assert.equal(normalizeCzechPhone("+420 112"), null);
  assert.equal(normalizeCzechPhone("+420 777 123 4567"), null);
  assert.equal(normalizeCzechPhone("abc"), null);
  assert.equal(normalizeCzechPhone(""), null);
});

test("customer phone accepts any E.164 number", () => {
  assert.equal(normalizeCustomerPhone("777 123 456"), "+420777123456");
  assert.equal(normalizeCustomerPhone("+49 151 23456789"), "+4915123456789");
  assert.equal(normalizeCustomerPhone("12"), null);
});

test("formats Czech numbers in groups", () => {
  assert.equal(formatPhone("+420777123456"), "+420 777 123 456");
  assert.equal(formatPhone("+4915123456789"), "+4915123456789");
});
