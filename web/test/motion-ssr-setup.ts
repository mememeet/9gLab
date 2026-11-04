// Bun shares module state between test files. Initialize Motion before any
// fixture installs a temporary window, so its SSR detection stays consistent.
import { initPrefersReducedMotion } from "motion-dom";

initPrefersReducedMotion();
