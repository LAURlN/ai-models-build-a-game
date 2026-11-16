# R03 results — M2+M3+M6 (reveal: A=Terra, B=Sol xhigh, C=Sol high, D=Hydrogen)

| | A Terra | B Sol xhigh | C Sol high | D Hydrogen |
|---|---|---|---|---|
| Attempts | 3 (2 continues) | 1 | 1 | 2 (1 crash) |
| Working time | 29m44s | 31m02s | 27m20s | 32m07s |
| API $ | 1.04 | 1.43 | 1.21 | 5.32 |
| Clean verification | pass | pass | pass | pass |
| Unit / e2e tests | 17 / 4 | 38 / 6 | 50 / 9 | 44 / 12 |
| Opus judge mean | 1.8 | 4.4 | **4.6** | 3.6 |
| Peer means (Sol / Terra / Hydrogen) | 2.4 / 2.4 / 1.4 | 4.4 / 4.2 / 4.8 | 3.8 / 3.8 / 4.6 | 3.0 / 3.2 / 3.4 |
| Mean of 4 AI reviewers | 2.0 | **4.45** | 4.2 | 3.3 |
| **User playtest** | 4th | **1st** | 3rd | 2nd |

First round where human and AI reviewers agree on the winner (Sol xhigh); the Opus judge alone preferred Sol high by 0.2.
Self-bias: Terra +0.53, Hydrogen +0.13, Sol high −0.53 (rated its own build below the others' mean and preferred xhigh).
Authorship: Hydrogen identified all four correctly (incl. Sol high vs xhigh). Sol thought B was its own (true, it was Sol xhigh) but swapped the others. Terra guessed at 30% and thought Hydrogen's build was its own.
Judge-reported defects: Hydrogen — all enemies share one RNG roll per enemy phase; loading a save restores spent Turnwheel charges. Terra — Rule IR hard-coded; renderer computes forecasts itself.
