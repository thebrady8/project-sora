import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("expanded catalog contains exactly 16,500 unique game/platform records", () => {
  const catalogPath = path.resolve("data/catalog.json");
  const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
  assert.equal(catalog.length, 16500);
  assert.equal(new Set(catalog.map((game) => game.id)).size, 16500);
  assert.ok(catalog.every((game) => game.name && game.platform));
});
