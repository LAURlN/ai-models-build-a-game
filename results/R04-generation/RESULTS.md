# R04 results — M4 + M5 + providers + UX (reveal: A=Opus high, B=Sol high, C=Terra high, D=Sol xhigh, E=Hydrogen high)

| | E Hydrogen | A Opus high | D Sol xhigh | B Sol high | C Terra |
|---|---|---|---|---|---|
| **User blind playtest** | **1st — "great in every way"** | 2nd ("quite good"; 1 fallback then real generation) | 3rd (always fell back) | 4th (provider connection failed) | 5th (no provider settings) |
| Attempts | 1 | Claude 5h limit → retry → disk stop → continue (+ user-prompted fix excluded) | 2 | 2 | 4 — unfinished |
| Working time | 104 min | 97 min | 104 min | 96 min | 34 min |
| API $ | 20.93 | ≈32 (incl. cache writes) | 7.31 | 5.62 | 1.52 |
| Live generations during dev | 1 (success) | 3 (smoke) | 0 | 0 | 0 |
| Opus judge mean | 3.0 | **4.6** | 3.6 | 3.4 | 2.0 |
| Peer Sol / Terra | 2.4 / 2.6 | 3.4 / 4.4 | 4.4 / 4.2 | 4.4 / 4.2 | 2.2 / 2.0 |
| AI mean (3 reviewers; Hydrogen peer pending) | 2.67 | **4.13** | 4.07 | 4.0 | 2.07 |

Human vs AI split again: the AI reviewers put Hydrogen 4th of 5; the user put it clearly 1st. Opus judge (same family) ranked the Opus build 1st — possible self-preference; Terra's peer review also ranked it 1st, Sol's 3rd.
Judge-reported concern for the winner: E does not deny native tools for Codex generation (security gap to fix before building on it).
Authorship: Sol identified all five correctly; Terra 1/5 (thought Sol xhigh's build was its own).
- User authorship guess: A=Sol xhigh, B=Hydrogen, C=Terra, D=Sol high, E=Opus → 1/5 correct (C).

## Hydrogen peer review (after Gemini quota reset)
Ranking A (Opus) > E (own) > D > B > C. Self-score 4.4 vs others' mean 2.67 → **self-bias +1.73**. Authorship guess 0/5 — thought its own build was Opus's (same mistake as the user).
Final AI means (4 reviewers): Opus 4.25, Sol xhigh 3.95, Sol high 3.8, Hydrogen 3.1, Terra 1.95. User: Hydrogen 1st.
