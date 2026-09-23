# @azarai/pi-math

Render LaTeX math as **inline images in the [pi](https://pi.dev) chat transcript**.

When the model calls the `math` tool, the formula is typeset to a transparent
PNG and displayed right in the conversation in terminals with image support
(**Kitty**, iTerm2, Ghostty, WezTerm). Formula color adapts to your terminal
theme automatically.

![pi-math demo](docs/demo.png)

## Features

- **In-flow rendering** — the tool registers custom `renderCall`/`renderResult`
  renderers and a `renderShell: "self"` shell (pi's `ToolDefinition` rendering
  contract), so no args JSON or tool frame clutters the transcript: you get one
  line of LaTeX source and the formula image directly beneath it, exactly where
  the formula belongs in the conversation
- **Model-invoked by design** — the tool's `promptGuidelines` instruct the
  model to call `math` whenever its reply contains a formula worth showing,
  instead of pasting raw LaTeX into the message
- **Theme-adaptive color** — matches your terminal's foreground color via
  kitty remote control; falls back to a `COLORFGBG` heuristic, then white
- **Lightweight** — no LaTeX installation: rendering uses matplotlib's
  mathtext engine (a large subset of LaTeX math) through system `python3`

## Install

```bash
pi install npm:@azarai/pi-math
```

Then just ask, e.g. *"render the Gaussian integral"*, or explicitly
*"use the math tool to show E = mc²"*.

## Prerequisites

- `python3` with `matplotlib` (`pip install matplotlib`); set `PI_MATH_PYTHON`
  to use another interpreter
- A terminal with image support (Kitty, iTerm2, Ghostty, WezTerm) for inline
  display; in other terminals the tool still works, the image is simply not
  shown inline

## Tool parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `latex` | string | LaTeX/mathtext source, without `$` delimiters |
| `color` | string? | `'auto'` (default), or any CSS/hex color |

## License

MIT
