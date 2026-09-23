/**
 * pi-math — render LaTeX math as inline images in the pi chat transcript.
 *
 * The rendered PNG is returned as an image content block, which pi displays
 * inline in terminals that support graphics protocols (Kitty, iTerm2,
 * Ghostty, WezTerm). Rendering uses matplotlib's mathtext engine through
 * system python3, so no LaTeX installation is required.
 *
 * Rendering contract (per pi's ToolDefinition API):
 *   - `renderShell: "self"` — the tool draws its own presentation instead of
 *     the default boxed tool shell, so the formula sits in the conversation
 *     flow instead of inside a tool-output frame.
 *   - `renderCall` — shows a compact preview of the LaTeX while the model is
 *     still streaming arguments.
 *   - `renderResult` — shows one line of LaTeX source; pi's
 *     ToolExecutionComponent appends the result's image blocks directly
 *     below that line, which puts the PNG exactly where the formula belongs.
 *
 * Text color auto-detects the terminal theme:
 *   1. kitty remote control (`kitten @ get-colors`) → foreground color
 *   2. COLORFGBG heuristic → black on light backgrounds
 *   3. fallback → white
 */
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Type } from "typebox";
import { Text } from "@earendil-works/pi-tui";
import type { Component } from "@earendil-works/pi-tui";
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";

const PYTHON = process.env.PI_MATH_PYTHON || "python3";

/** Render argv: [latex, outFile, color]. Prints nothing on success. */
const RENDER_PY = [
	"import sys",
	"import matplotlib",
	'matplotlib.use("Agg")',
	"import matplotlib.pyplot as plt",
	"",
	"latex, out, color = sys.argv[1], sys.argv[2], sys.argv[3]",
	"try:",
	'    fig = plt.figure(figsize=(0.1, 0.1))',
	'    fig.text(0, 0, "$" + latex + "$", fontsize=16, color=color)',
	'    fig.savefig(out, dpi=150, bbox_inches="tight", pad_inches=0.1, transparent=True)',
	"except Exception as e:",
	"    sys.stderr.write(str(e))",
	"    sys.exit(1)",
].join("\n");

interface ExecResult {
	code: number;
	stdout: string;
	stderr: string;
}

function exec(cmd: string, args: string[], timeoutMs: number, signal?: AbortSignal): Promise<ExecResult> {
	return new Promise((resolve) => {
		const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
		const onAbort = () => child.kill("SIGKILL");
		if (signal?.aborted) child.kill("SIGKILL");
		signal?.addEventListener("abort", onAbort, { once: true });
		child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
		child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
		child.on("error", (err) => {
			clearTimeout(timer);
			resolve({ code: -1, stdout, stderr: stderr + String(err) });
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
			resolve({ code: code ?? -1, stdout, stderr });
		});
	});
}

/** Cached python3 + matplotlib availability check. Returns an error message or null. */
let pythonChecked = false;
let pythonOk = false;

async function checkPython(): Promise<string | null> {
	if (!pythonChecked) {
		const r = await exec(PYTHON, ["-c", "import matplotlib"], 60_000);
		pythonOk = r.code === 0;
		pythonChecked = true;
	}
	if (pythonOk) return null;
	return (
		`pi-math needs ${PYTHON} with matplotlib, and it is not available. ` +
		`Install it first, e.g.: pip install matplotlib ` +
		`(or point PI_MATH_PYTHON at a python that has it).`
	);
}

/** Detect a formula color that matches the terminal theme. */
async function detectColor(): Promise<string> {
	// 1) kitty remote control: use the terminal's own foreground color
	const r = await exec("kitten", ["@", "get-colors"], 3_000);
	if (r.code === 0) {
		const m = r.stdout.match(/^foreground\s+(#[0-9a-fA-F]{3,8})\s*$/m);
		if (m) return m[1];
	}
	// 2) COLORFGBG heuristic: "15;0" style palette indices, last field = background
	const fgbg = process.env.COLORFGBG;
	if (fgbg) {
		const bg = Number(fgbg.split(";").pop());
		if (Number.isInteger(bg)) return bg === 7 || bg === 15 ? "#000000" : "#ffffff";
	}
	// 3) assume a dark terminal
	return "#ffffff";
}

interface MathDetails {
	latex: string;
	color: string;
	/** Present when rendering failed; drives the error display. */
	error?: string;
}

/** One-line LaTeX preview, kept within a sane column budget. */
function latexLine(latex: string, maxLen = 200): string {
	const one = latex.replace(/\s+/g, " ").trim();
	return one.length > maxLen ? `${one.slice(0, maxLen - 1)}…` : one;
}

export default function mathExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "math",
		label: "Math",
		description:
			"Typeset a LaTeX math expression and display it as an image inline in the chat. " +
			"Uses matplotlib mathtext syntax (a large subset of LaTeX math). " +
			"Whenever your response contains a formula worth showing — an equation, derivation step, " +
			"or expression the user should see — call this tool so the formula is rendered visually, " +
			"instead of writing raw LaTeX in your message.",
		promptSnippet: "Typeset LaTeX math as an inline image",
		promptGuidelines: [
			"When your reply includes a mathematical formula, call the math tool to render it " +
				"(raw LaTeX without $ delimiters) instead of writing the LaTeX in your message text; " +
				"the rendered image appears inline in the conversation. Short inline symbols like x² are fine as plain text.",
			"Use the math tool when the user asks to see, show, display, or render a formula or equation; pass raw LaTeX without $ delimiters.",
		],
		parameters: Type.Object({
			latex: Type.String({
				description: "LaTeX/mathtext source, e.g. \\int_0^1 x^2\\,dx (no $ delimiters)",
			}),
			color: Type.Optional(
				Type.String({
					description:
						"Text color: 'auto' (default, matches terminal theme), or a CSS/hex color like '#ffffff'",
				}),
			),
		}),
		renderShell: "self",

		renderCall(args: { latex?: string }, theme: Theme): Component {
			const latex = latexLine(args.latex ?? "");
			return new Text(
				`${theme.fg("toolTitle", theme.bold("∑"))} ${theme.fg("accent", latex || "…")}`,
				0,
				0,
			);
		},

		renderResult(
			result: { content: { type: string }[]; details?: MathDetails; isError?: boolean },
			{ isPartial }: { expanded: boolean; isPartial: boolean },
			theme: Theme,
		): Component {
			if (isPartial) {
				return new Text(theme.fg("warning", "∑ typesetting…"), 0, 0);
			}
			const details = result.details;
			if (!details) {
				return new Text(theme.fg("muted", "∑"), 0, 0);
			}
			if (details.error) {
				const oneLine = details.error.replace(/\s+/g, " ").trim();
				return new Text(
					`${theme.fg("error", "∑ math failed:")} ${theme.fg("dim", oneLine.slice(0, 160))}`,
					0,
					0,
				);
			}
			// Success: keep the transcript minimal — the LaTeX source is already
			// shown by renderCall above, and pi appends the image blocks directly
			// after this line, so the formula lands right under its source.
			return new Text("", 0, 0);
		},

		async execute(_toolCallId, params, signal) {
			const latex = params.latex.replace(/^\$+|\$+$/g, "").trim();
			const color =
				params.color && params.color !== "auto" ? params.color : await detectColor();

			const problem = await checkPython();
			if (problem) {
				const details: MathDetails = { latex, color, error: problem };
				return { content: [{ type: "text", text: problem }], details };
			}

			const dir = await mkdtemp(path.join(tmpdir(), "pi-math-"));
			const file = path.join(dir, "math.png");
			try {
				const r = await exec(PYTHON, ["-c", RENDER_PY, latex, file, color], 60_000, signal);
				if (r.code !== 0) {
					const message = `mathtext failed: ${r.stderr.trim() || `exit code ${r.code}`}`;
					const details: MathDetails = { latex, color, error: message };
					return {
						content: [{ type: "text", text: message }],
						details,
					};
				}
				const data = (await readFile(file)).toString("base64");
				return {
					content: [
						{ type: "text", text: `Rendered: ${latex}` },
						{ type: "image", data, mimeType: "image/png" },
					],
					details: { latex, color } satisfies MathDetails,
				};
			} finally {
				rm(dir, { recursive: true, force: true }).catch(() => {});
			}
		},
	});
}
