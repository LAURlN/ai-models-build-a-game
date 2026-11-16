# R06 results: limitless campaigns (reveal: A = Sol xhigh, B = Hydrogen high, C = Sol high, D = Fable 5.2 → Opus 5.5, E = Terra high)

| | D Fable→Opus | B Hydrogen | A Sol xhigh | C Sol high | E Terra |
|---|---|---|---|---|---|
| **User blind playtest** | **1st, "by far the best"** | 2nd (campaign worked; weak music and battle) | 3rd (music, but barely did anything) | 4th (never started a proper fight) | 5th (failed to generate a chapter) |
| Attempts | 2 Claude 5-hour limit waits, then a manual model switch to Opus by the user | 1 | 1 | 1 | 6 (5 continues), self-reported incomplete |
| Working time | 328 min | 102 min | 83 min | 190 min | 331 min |
| API $ (list prices) | 31–49 (Fable/Opus split unknown) | 15.31 | 4.43 | 7.64 | 13.82 |
| Share of weekly subscription value* | 11–18 % of Claude Pro | 20 % of Google AI Pro | 1.0 % of ChatGPT Pro | 1.7 % of ChatGPT Pro | 3.0 % of ChatGPT Pro |
| Live generations during development (max 10) | 10 | 5 | 0 | 0 | 0 |
| Self-reported tests (unit / e2e) | 82 / 17 | 59 / 15 | 60 / 15 | 64 / 15 (verified from a fresh clone) | 76 / 17 |
| AI peer mean (3 peers, of 5) | **4.67** | 3.47 | 3.00 | 3.73 | 2.33 |

\* Weekly API-value pools: ChatGPT Pro ≈ $460, Claude Pro ≈ $276, Google AI Pro ≈ $78 (the user's figures: about 20×, 60× and 17× the subscription price per month).

Notes and caveats:
- No neutral judge this round: the Opus judge was skipped to save Claude quota, so the AI column is the three contestant peers (Sol high, Terra high, Hydrogen high).
- The winning build is a hybrid. Fable 5.2 started it, used up two Claude Pro 5-hour windows plus a reset, and the user switched the thread to Opus 5.5 to finish. Its cost is a range because the turns that ended in limit errors were only partly recorded.
- For the first time, all reviewers agreed with the user on the top and the bottom: the Claude build first, Terra last.
- The two builds that tested with real generations during development are exactly the user's top two.
- Hydrogen was 1st or 2nd in the user's playtest for the fourth contest running, while the AI reviewers again placed it mid-field.
- Peer authorship guesses: Sol 3/5, Terra 3/5 (both swapped Sol high and xhigh), Hydrogen 1/5 (did not recognise its own build).
- Fresh-clone verification was paused during the playtest. Only Sol high's build was verified before the pause; the winner is verified separately before the merge.
