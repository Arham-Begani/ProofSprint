# ProofSprint

**Good guess. Now prove it.**

ProofSprint is a local evidence workbench for inspecting puzzle answers. Compare competing proposals, trace exact quotations to supplied sources, challenge recorded checks, preserve uncertainty, and prepare an unsent answer draft.

The interface includes an interactive saved-practice comparison, searchable sessions, proof-section shortcuts, a mobile answer picker and optional motion. Reduced motion is respected by default; effects can be enabled or paused for the current visit.

This is reusable preparation tooling. It is not a solution to the unreleased fmsg challenge, a claim of live Astra accuracy, or an independent human review.

## Try it locally

Install Node.js 24, then:

```sh
npm ci
npm run workbench
```

Open `http://127.0.0.1:43129/` and choose **Try the proof lab**. A practice case runs deterministic local calculations and saves correct and rejected alternatives. Select an answer, inspect its checks and evidence, then open **Review draft**. A rejected or unresolved answer cannot export. Nothing is submitted from the app.

A fresh checkout contains no sessions. The interactive home preview appears after creating a public arithmetic practice session. Synthetic unique and ambiguous cases are also available. Practice results are always labeled and never substituted for live model results.

Windows users can also run `./Run-ProofSprint.ps1 workbench`. The launcher uses an adjacent local Node 24 runtime when available, otherwise installed Node 24.

## Evidence workflow

1. Import an original puzzle packet with prompt, constraints, source passages, version and accurate practice/competition label.
2. Generate or record separate proposals. The optional model runner requests a blind verifier checklist before reviewing proposals.
3. Inspect exact answers, source quotations, requirement checks, conflicting evidence and unresolved assumptions.
4. Revise the source packet when conditions change; old reviews cannot certify the new version.
5. Export an unsent Markdown draft only after structural gates pass. A person must still assess correctness and source quality.

A role label is not proof that another person or model wrote a record. A quotation matching a source is not proof of its truth. Session hash chains detect accidental corruption; they are not signed protection against an operator who controls the filesystem.

## CLI and optional models

```sh
npm start -- demo unique
npm start -- demo ambiguous
npm start -- new examples/research-packet.json
npm start -- show SESSION_ID
npm start -- model-status
```

Use `prompt SESSION_ID solver-a`, `prompt SESSION_ID solver-b` and `prompt SESSION_ID verifier` for role packets. `export SESSION_ID CANDIDATE_ID NEW_FILE.md` writes an unsent draft without overwriting an existing file.

Live model calls are disabled by default. `.env.example` contains empty credential placeholders and a requested Astra configuration, not credentials or measured model results. The app does not automatically load this file. An operator must separately configure supported model access and enable usage in the process environment. Each enabled round has bounded requests, token limits and timeouts; these are not a monetary cap. Provider failures remain failures. The adapter does not browse, run arbitrary code or send messages.

The optional Eve interface exposes session inspection, bounded rounds and draft preparation. Its tools share the same local store. No registration or submission tool is configured.

## Verify

```sh
npm test
npm run check
npm run typecheck
npm run agent:build
```

On Windows, `./Run-ProofSprint.ps1 agent-build` bounds build workers and skips sandbox prewarming. Tests use temporary directories and deterministic or injected adapters. They do not call live providers.

See [validation](docs/VALIDATION-PUBLIC.md), [operating playbook](docs/PLAYBOOK.md), [design](docs/DESIGN.md), and [publication scope](docs/PUBLICATION.md).

## Event status and submission

See the [official rules and registration page](https://fmsg.ai/hackathon) and [event notes](docs/EVENT.md). This project has not registered or submitted anything. The rules page is not a solution-submission form; the judge destination is announced at kickoff.

## Data, rights and scope

The server binds to loopback and checks request origins and a process token for writes. Keep it local; this filesystem store is not a hosted multi-user database. Sessions stay under the ignored `.proofsprint/` directory. Never commit real packets, credentials, model responses or private evidence without a separate publication review.

This public edition excludes the historical seven-fixture benchmark and its tests because they contain third-party inputs not cleared for republication. The complete local research copy was preserved separately. Public test counts therefore differ from the historical 69-test local suite.

The included Project Euler problem 1 excerpt and adapted task carry **CC BY-NC-SA 4.0** attribution and restrictions; see [third-party notices](THIRD_PARTY_NOTICES.md). Original synthetic examples and application code are distinct from that licensed problem content. No blanket license for the original project code has been selected. Public visibility does not itself grant a general software license.
