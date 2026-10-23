import assert from "node:assert/strict";
import { test } from "node:test";
import { buildQuery } from "./sql-template";

const q = (strings: TemplateStringsArray, ...values: unknown[]) => buildQuery(strings, values);

test("turns template values into numbered bind parameters", () => {
  const name = "x'; DROP TABLE orders; --";
  assert.deepEqual(q`SELECT * FROM t WHERE a = ${name} AND b = ${2}`, {
    text: "SELECT * FROM t WHERE a = $1 AND b = $2",
    params: [name, 2],
  });
});

test("works without values", () => {
  assert.deepEqual(q`SELECT 1`, { text: "SELECT 1", params: [] });
});
