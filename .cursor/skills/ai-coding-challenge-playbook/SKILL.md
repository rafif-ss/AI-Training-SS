---
name: ai-coding-challenge-playbook
description: >-
  Run weekly AI coding challenges (critical thinking vs AI assistants). Use when
  the user pastes a Week N challenge, a coupon/webhook/benchmark/migration-style
  trap, or asks to improve a challenge answer using the training playbook.
---

# AI Coding Challenge Playbook (v2)

Read and follow `PLAYBOOK-AI-CODING-CHALLENGES.md` at the workspace root. Start from its section 0 (quick card).

## Default workflow (do not skip)

1. If the user pasted **their own findings**, validate / attack / extend them first. Do **not** jump to the final 7-part answer.
2. Compute the **budget from the stated facts** (formula, number, pass/fail) before proposing any tool.
3. Run the playbook's **10 neighbour questions** (exit paths, resources, memory shape, data correctness, concurrency, deploy neighbours such as replica / old code / prepared statements, failure midway, security, process, input validation) and add what the user missed.
4. Name the docs to open (use docs tools when available). Never invent headers, isolation guarantees, or API shapes from memory. If a docs quote is needed, ask the user to paste the text.
5. Write the **harness and a predictions file**, but **do not run the harness yourself**. The user runs it and pastes raw logs. Until then everything is `NOT RUN`. If the user explicitly asks you to run something, label it `RUN by <AI> under the user's approval` and tell them to re-run the key scenario themselves.
6. After logs exist: correct estimates, recompute every figure from the log (never from memory), and harden the verdict from measured numbers.
7. Help with mutants (each bug put back turns only its own gate red, then a positive control passes), a prediction of the AI's likely flawed fix, and a test of the follow-up prompt in a fresh session.
8. Only then draft the English answer, then attack the draft for overclaims.

## Evidence rules

- Every number is labelled `RUN by <who> on <data>`, `DERIVED (formula)` or `NOT RUN`. Never invent output.
- Local stand-ins are demos: put `SIMULATED` on the first line of the Verdict. Never call a self-made contract "real".
- Prefer tests that hit the real code path over rewritten copies. Verify with an independent checker, not the code's own logic.
- Pass rules use exact counts. Reject "at most N" and tests that cannot fail.
- Repeat key runs at least 3 times; compute min/median/max with a script.
- Reject tiny benchmarks, sequential unit tests, and temporary security bypasses as proof.
- Never ask the user to paste secrets or real data into a prompt.

## Format and voice

- Final answers: English, 7 parts per the playbook, **no tables** (the user pastes them into chat, where tables break). Bullets and code blocks are fine.
- Verdict line 1: `SIMULATED`/`REAL` + who ran + rig. Line 2: a single word `NO` or `YES`.
- Write in the user's own voice; avoid phrasing that reads like raw model output.
- Discussion may be Indonesian.
