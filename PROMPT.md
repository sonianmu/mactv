# The prompt

Clone this repository on the Mac, open a coding agent with shell access in it (Claude Code or similar), and
paste the text below. Fill in the two models. Expect to be asked to do a few things yourself: create a user,
switch Screen Sharing on, accept prompts on the TV, type a PIN.

---

I want my Android TV to get its own session on this Mac, streamed to the TV and controlled with the TV
remote, using this repository (MacTV). My Mac is: <MAC MODEL>. My TV is: <TV MODEL>.

Read AGENTS.md, then docs/concepts.md so you know what each part is for, then follow
agent/playbook.md phase by phase. Check profiles/ for what is already known about my devices. Keep to the
hard rules in AGENTS.md: never send Screen Sharing's SetDisplayConfiguration, never kill Screen Sharing
processes, ask me before any sudo, user creation, sharing setting, TV install or reboot, check whether
someone is watching the TV before touching it, and never write my passwords, tokens, IP or MAC addresses
into any file. Verify each phase with its check and show me the results. When something differs on my
devices, follow agent/adapt.md: find the layer, fix it in the right place (config, an app's app.json, a
device profile, or the engine with a test) and tell me. At the end, give me a short summary, a device
report, and any new device profile.

---

What you'll need: macOS 14.2+ (Apple silicon), Google Chrome, the Xcode command line tools, an Android TV
with developer options, and ideally an Ethernet cable for the Mac (4K needs ~40 Mbps).
