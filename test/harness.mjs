/**
 * Standalone harness: load the pi-math extension, call the registered tool
 * directly, and verify the returned content blocks.
 *
 * Run: node test/harness.mjs
 */
import assert from "node:assert/strict";
import mathExtension from "../extensions/math.ts";

const registered = [];
const pi = { registerTool: (d) => registered.push(d) };
mathExtension(pi);

assert.equal(registered.length, 1, "one tool registered");
const tool = registered[0];
assert.equal(tool.name, "math");

// 1. happy path with auto color
const r1 = await tool.execute("t1", { latex: "$\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}$" }, undefined, undefined, undefined);
console.log("details:", JSON.stringify(r1.details));
assert.ok(r1.details.color.startsWith("#"), "color detected");
const img1 = r1.content.find((c) => c.type === "image");
assert.ok(img1, "image block present");
const bytes = Buffer.from(img1.data, "base64");
assert.ok(bytes.length > 500, `png is substantial (${bytes.length} bytes)`);
assert.equal(bytes[0], 0x89, "PNG magic byte");
console.log("auto-color png:", bytes.length, "bytes, color:", r1.details.color);

// 2. explicit color
const r2 = await tool.execute("t2", { latex: "E = mc^2", color: "#f7768e" }, undefined, undefined, undefined);
assert.equal(r2.details.color, "#f7768e");
assert.ok(r2.content.some((c) => c.type === "image"));
console.log("explicit-color png ok");

// 3. bad latex -> text error, no crash
const r3 = await tool.execute("t3", { latex: "\\unknowncmd{x}" }, undefined, undefined, undefined);
assert.ok(r3.content.every((c) => c.type === "text"), "error path returns text only");
console.log("error path:", r3.content[0].text.slice(0, 60));

// 4. signal abort is respected (killed render -> nonzero exit -> text error)
const ac = new AbortController();
ac.abort();
const r4 = await tool.execute("t4", { latex: "x" }, ac.signal, undefined, undefined);
assert.ok(r4.content.every((c) => c.type === "text"));
console.log("abort path ok");

console.log("\nALL TESTS PASSED");
