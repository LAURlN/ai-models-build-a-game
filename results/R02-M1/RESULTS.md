# R02 results — M1 micro-battle (reveal: A=Terra, B=Sol, C=Hydrogen)

| | Terra (A) | Sol (B) | Hydrogen (C) |
|---|---|---|---|
| Wall time | 7m01s | 15m31s | 11m58s failed + ~4m retry (then 40-min hang in final message, cancelled) |
| Tokens uncached / cache / out | 35k / 1.60M / 11.6k | 54k / 2.35M / 32.7k | 479k / 6.70M / 78.3k (both runs) |
| API cost | $0.17 | $0.67 | $1.81 |
| Clean verification | all pass | all pass | all pass |
| Unit tests | 5 | 21 | 9 |
| Real result | board never renders (CSP blocks PixiJS) — e2e passes by clicking invisible buttons | playable; clickable grid misaligned | playable, functionally best |
| Opus judge (eng.) mean | 1.8 | **4.8** | 4.6 |
| Peer means (Sol / Terra / Hydrogen) | 4.0 / 4.4 / 2.8 | 5.0 / 4.8 / 4.8 | 4.2 / 4.6 / 4.2 |
| Mean of 4 AI reviewers | 3.25 | **4.85** | 4.4 |
| **User blind playtest** | 3rd | 2nd | **1st — clear winner** |

All four AI reviewers ranked B (Sol) > C (Hydrogen) > A (Terra). Only the Opus judge caught that A's board never renders; no AI reviewer noticed B's grid misalignment.
Self-bias (own score − others' mean): Terra +1.53, Sol +0.2, Hydrogen −0.27.
Authorship guesses: Sol 3/3, Hydrogen 3/3, Terra 1/3 (thought its own build was Sol's).
Overhead: Opus judge $1.11. Peer reviews: Sol $0.28, Terra $0.08, Hydrogen $0.51.
