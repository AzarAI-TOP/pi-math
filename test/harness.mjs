/**
 * Standalone harness: load the pi-math extension, call the registered tool
 * directly, and verify the returned content blocks plus the custom renderers.
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

// Minimal theme/themeless stub: strip styling so we can assert on plain text.
const theme = {
	fg: (_name, text) => text,
	bg: (_name, text) => text,
	bold: (text) => text,
};

// 1. happy path with auto color
const r1 = await tool.execute("t1", { latex: "$\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}$" }, undefined, undefined, undefined);
console.log("details:", JSON.stringify(r1.details));
assert.ok(r1.details.color.startsWith("#"), "color detected");
const img1 = r1.content.find((c) => c.type === "image");
assert.ok(img1, "image block present");
const bytes = Buffer.from(img1.data, "base64");
assert.ok(bytes.length > 500, `png is substantial (${bytes.length} bytes)`);
assert.equal(bytes[0], 0x89, "PNG magic byte");
assert.ok(r1.content[0].type === "text" && r1.content[0].text.startsWith("Rendered:"), "clean model-facing text");
console.log("auto-color png:", bytes.length, "bytes, color:", r1.details.color);

// 2. explicit color
const r2 = await tool.execute("t2", { latex: "E = mc^2", color: "#f7768e" }, undefined, undefined, undefined);
assert.equal(r2.details.color, "#f7768e");
assert.ok(r2.content.some((c) => c.type === "image"));
console.log("explicit-color png ok");

// 3. bad latex -> text error, no crash, details.error recorded
const r3 = await tool.execute("t3", { latex: "\\unknowncmd{x}" }, undefined, undefined, undefined);
assert.ok(r3.content.every((c) => c.type === "text"), "error path returns text only");
assert.ok(r3.details.error, "details.error present for renderer");
console.log("error path:", r3.content[0].text.slice(0, 60));

// 4. signal abort is respected (killed render -> nonzero exit -> text error)
const ac = new AbortController();
ac.abort();
const r4 = await tool.execute("t4", { latex: "x" }, ac.signal, undefined, undefined);
assert.ok(r4.content.every((c) => c.type === "text"));
console.log("abort path ok");

// 5. renderCall: one compact line with the latex source
assert.equal(tool.renderShell, "self", "self shell so the formula sits in the conversation flow");
const callView = tool.renderCall({ latex: "\\int_0^1 x^2\\,dx" }, theme, { state: {} });
const callLines = callView.render(80);
assert.equal(callLines.length, 1, "call renders one line");
assert.ok(callLines[0].includes("\\int_0^1 x^2\\,dx"), "call shows latex source");
console.log("renderCall:", callLines[0]);

// 6. renderResult success: zero lines (image is appended by pi below the call line)
const okView = tool.renderResult(r1, { expanded: false, isPartial: false }, theme, { state: {} });
assert.equal(okView.render(80).length, 0, "success result renders nothing extra");
console.log("renderResult (success): 0 extra lines, image follows call line");

// 7. renderResult failure: compact error line(s)
const errView = tool.renderResult(r3, { expanded: false, isPartial: false }, theme, { state: {} });
const errLines = errView.render(200);
assert.ok(errLines.length >= 1 && errLines[0].includes("math failed:"), "error line mentions failure");
assert.ok(errLines.length <= 2, "error stays compact");
console.log("renderResult (error):", errLines[0].slice(0, 60));

console.log("\nALL TESTS PASSED");
