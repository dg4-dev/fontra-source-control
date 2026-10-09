import assert from "node:assert/strict";
import { test } from "node:test";
import { layoutGraph } from "../src/graph-layout.js";

const commit = (hash, ...parents) => ({ hash, parents });

test("a straight history stays in one lane", () => {
  const { rows, laneCount } = layoutGraph([
    commit("c", "b"),
    commit("b", "a"),
    commit("a"),
  ]);
  assert.equal(laneCount, 1);
  assert.deepEqual(
    rows.map((row) => row.lane),
    [0, 0, 0]
  );
  assert.deepEqual(rows[0].top, []);
  assert.deepEqual(rows[0].bottom, [{ from: 0, to: 0, color: 0 }]);
  assert.deepEqual(rows[2].bottom, []);
});

test("a merge opens a lane for the second parent and closes it at the fork", () => {
  // m merges f into main; f and b both have a as parent
  const { rows, laneCount } = layoutGraph([
    commit("m", "b", "f"),
    commit("f", "a"),
    commit("b", "a"),
    commit("a"),
  ]);
  assert.equal(laneCount, 2);
  const [m, f, b, a] = rows;
  assert.equal(m.lane, 0);
  assert.deepEqual(m.bottom, [
    { from: 0, to: 0, color: 0 },
    { from: 0, to: 1, color: 1 },
  ]);
  assert.equal(f.lane, 1);
  // Lane 0 passes by f's row
  assert.ok(f.top.some((edge) => edge.from === 0 && edge.to === 0));
  assert.ok(f.bottom.some((edge) => edge.from === 0 && edge.to === 0));
  assert.equal(b.lane, 0);
  // Both lanes end in a
  assert.equal(a.lane, 0);
  assert.deepEqual(a.top.map((edge) => [edge.from, edge.to]).sort(), [
    [0, 0],
    [1, 0],
  ]);
});

test("branch tips get their own lane and colors", () => {
  const { rows } = layoutGraph([commit("x", "a"), commit("y", "a"), commit("a")]);
  assert.equal(rows[0].lane, 0);
  assert.equal(rows[1].lane, 1);
  assert.notEqual(rows[0].color, rows[1].color);
  assert.equal(rows[2].lane, 0);
});

test("freed lanes are reused", () => {
  const { rows, laneCount } = layoutGraph([
    commit("m2", "m1", "f2"),
    commit("f2", "m0"),
    commit("m1", "m0"),
    commit("m0", "base", "f1"),
    commit("f1", "base"),
    commit("base"),
  ]);
  assert.equal(laneCount, 2);
  assert.equal(rows[4].lane, 1);
});

test("parents outside the loaded page keep their lane open", () => {
  const { rows } = layoutGraph([commit("b", "a")]);
  assert.deepEqual(rows[0].bottom, [{ from: 0, to: 0, color: 0 }]);
});
