# Public edition validation

Publication preparation was performed after the studio redesign was completed. The original local research edition passed 69 tests. This public edition deliberately omits six benchmark tests with their restricted-input suite; it does not claim to contain or reproduce that suite.

## Checks run on this public copy

- Node 24 serial regression suite: **63 passed, 0 failed**. Includes evidence gates, persistence, provider error handling using injected generators, Eve tool schemas, public arithmetic validation, UI logic and actual loopback HTTP workflow tests.
- TypeScript `tsc --noEmit`: passed.
- JavaScript syntax checks for the workbench and browser entry: passed.
- Source comparison: copied application, UI, agent, synthetic example and retained test files matched the verified local edition apart from normalizing line endings and final blank lines for publication. Public-only changes are the rights notice on the arithmetic script, omitted benchmark commands, ignore rules and documentation.
- Public-source scan: no recognized credentials, private user paths, private network addresses, credential-bearing URLs or raw conversation blocks found. Environment template credential value is empty. The dependency directory, runtime, generated outputs, private sessions, screenshots and logs are not tracked.

An initial local validation attempt lacked dependencies in the clean copy. Reusing the already installed dependency tree resolved that setup issue; the final suite above passed. Dependencies themselves are not published.

## Build limitation

The earlier original local Eve build passed. Two attempts to build this public copy stopped while Eve fetched public AI Gateway metadata for `openai/gpt-6-astra` with `fetch failed`. The public copy's fresh Eve build is therefore **not verified**. Agent configuration was preserved; no credential, model switch or invented metadata was used to bypass this. The directly runnable local web workbench does not require the Eve build, and its HTTP workflow tests passed.

## Prior UI verification retained by source identity

The unchanged studio UI was exercised at CSS widths 320, 400, 768 and 1440. Horizontal overflow discovered at 320 was fixed. The sampled landing/workspace text contrast checks found no failures: minimum normal-text ratio 5.30:1; large display numerals 3.43:1. Keyboard session search, focus wrap, section focus, mobile answer selection, malformed import feedback, unsent draft display and the rejected-draft gate were checked. Motion defaults respected reduced-motion preference, with explicit enable/pause controls.

These are scoped checks, not a full WCAG certification. Screen-reader behavior and pointer-tilt input were not comprehensively tested. Historical screenshots and raw logs stay local because they contain session and environment context.

## What this does not prove

No live Astra/model accuracy measurement, external research study, independent human proof review, competition eligibility verification or secret-puzzle solution occurred. Deterministic arithmetic and injected adapters are labeled practice/testing. No external submission or deployment was performed.
