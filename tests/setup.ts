import { afterEach } from 'vitest';

/**
 * Yield a real macrotask between test cases.
 *
 * These suites are CPU-bound: a single case can run tens of thousands of races in
 * one uninterrupted synchronous loop. The vitest worker reports progress to the
 * main process over an RPC whose reply arrives as a process message, and messages
 * are only delivered on the macrotask queue. Awaiting a synchronous test drains
 * microtasks but never the message queue, so a file whose cases block back-to-back
 * for longer than the RPC timeout never acknowledges `onTaskUpdate` - and the run
 * exits non-zero with `[vitest-worker]: Timeout calling "onTaskUpdate"` even though
 * every assertion passed.
 *
 * A zero-delay timer costs nothing per case and lets that reply through.
 */
afterEach(() => new Promise((resolve) => setTimeout(resolve, 0)));
