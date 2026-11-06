# ProofSprint operating playbook

## The idea

Win time by making uncertain reasoning easy to inspect. Two solvers receive the same original packet separately. A verifier writes an acceptance checklist before seeing either proposal. Each proposed answer carries exact source quotations, explicit constraint checks and its unresolved assumptions. The verifier then attempts an independent reconstruction. Disagreement becomes a concrete next check rather than a vote.

This is a reusable workflow. The actual challenge is unknown, so the strategies below are speculative and are not purported solutions.

## Choose the approach after reading the puzzle

| Approach | Use when | First decisive check | Current support |
| --- | --- | --- | --- |
| Constraint elimination | Finite choices, arithmetic or logical relations | Enumerate all surviving alternatives, then reproduce the decisive relation independently | The digit rehearsal demonstrates finite search and an independent algebraic check. Arbitrary puzzles still need an adapted method. |
| Evidence reconstruction | Clues identify an entity, event or document | Match all clues against original passages; check whether apparently independent sources copy one origin | Packets store source text and declared origins. A fictional research packet illustrates copied-source risk. Live source retrieval remains manual. |
| Representation audit | Encodings, exact strings, unit changes, ambiguous punctuation or media clues | Preserve the original representation and test one explicit interpretation at a time | Exact answer strings and packet versions are preserved. OCR, audio, image and decoding tools are not implemented. |

## The working loop

1. Capture the original puzzle and source passages faithfully. Assign stable constraint IDs and an accurate practice/competition label. Record the version before proposing an answer.
2. Produce independent proposals and a blind verifier checklist. Give checklist requirements and ambiguities stable IDs; map all supplied constraint IDs. Every requirement and ambiguity gets an explicit result and evidence links in the final review. Use exported role packets manually, or the bounded model runner after configuration. A model error stays an error.
3. Compare the review findings. Prioritize a check that could eliminate a candidate or resolve a missing requirement. More agreement from the same sources does not establish correctness.
4. When new source text or constraints arrive, revise the packet. Old reviews remain archived and cannot certify the new version. When only a proposal changes, record a new candidate ID and obtain a fresh review.
5. Stop a line of investigation after two passes add no decisive evidence. Inspect the weakest assumption, change the method or request the missing source. Do not automatically repeat a failed or interrupted model round.
6. Export only when structural gates pass. A person checks substantive correctness and the exact answer format before any separately authorized submission.

## A useful first rehearsal

Run `demo unique`, then `demo ambiguous`. The first produces `7,3`; the second preserves four alternatives. Review the saved evidence and the reasons the second cannot export. Next import `examples/research-packet.json` to inspect the source-origin groups. Its entities and claims are fictional, and it is not a live model benchmark.

## What still depends on the reveal

The puzzle determines which strategy fits, whether additional tools are necessary and how an answer should be formatted. The workflow does not infer a challenge from the prize or claim that a practice result will transfer. Model accuracy, real-puzzle correctness, entrant eligibility and eventual submission remain separate checks.
