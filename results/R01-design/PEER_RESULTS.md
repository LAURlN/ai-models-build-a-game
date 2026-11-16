# R01b peer review results (A=Hydrogen, B=Sol, C=Terra)

Rubric mean (correctness, completeness, evidence, instructions, usefulness; creativity separate):

| Reviewer | A Hydrogen | B Sol | C Terra | Ranking | Authorship guess |
|---|---|---|---|---|---|
| Sonnet 5.5 high (neutral) | 3.8 | 4.6 | 3.4 | Sol > Hydrogen > Terra | — |
| Sol high | 3.0 | 4.8 | 4.0 | Sol > Terra > Hydrogen | all 3 correct (A 85%, B 70%, C 65%); own = B at 40% ✔ |
| Terra high | 3.4 | 4.6 | 4.2 | Sol > Terra > Hydrogen | A ✔, swapped B/C (40% each); thought B (Sol's) was its own ✘ |
| Hydrogen high | 4.4 | 5.0 | 3.0 | Sol > Hydrogen > Terra | A ✔ own (75%), swapped B/C (60%) |
| **Mean of 4** | **3.65** | **4.75** | **3.65** | Sol 1st unanimously | |
| Creativity mean | 4.75 | 4.5 | 3.25 | | |

Self-score vs others' mean for the same proposal: Hydrogen +1.0, Terra +0.73, Sol +0.07.
Both OpenAI models put Terra over Hydrogen; Hydrogen and the neutral Sonnet put Hydrogen over Terra.

Review runs (wall / uncached in / cached / out): Terra 62s / 39k / 323k / 1.7k; Hydrogen 113s / 75k / 232k / 12.8k (9.1k thinking); Sol 163s / 79k / 722k / 3.9k.
Worktrees: sol t3-85076742, terra t3-097bf57f, hydrogen t3-a9c79f2e. Copies in peer/<reviewer>/.
