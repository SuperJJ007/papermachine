#!/usr/bin/env node
// Fake kernel driver that never sends READY: exercises KernelProcess's
// spawn-to-READY deadline. Stays alive (does not exit) so the timeout, not a
// process exit, is what KernelProcess.start() observes.
setInterval(() => {}, 1_000)
