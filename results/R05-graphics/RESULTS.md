# R05 results: graphics, animation, UI polish

Blind map: A = Opus 5.5 high, B = Sol high, C = Terra high, D = Hydrogen high, E = Sol xhigh.

## Verdict (user, blind playtest: visuals and feel)

**E > D > A > B > C.** The winner is **Sol xhigh** (E), which becomes the base for R06.

| Build | Model | User | Playtest notes | AI engineering mean (of 25) |
|---|---|---|---|---|
| E | Sol xhigh | 1 | Maybe the favourite on looks; no sound | 19.75 |
| D | Hydrogen high | 2 | Pretty nice; the only build with sound | 18.5 |
| A | Opus high | 3 | Pretty nice; slow startup; a few hiccups | 23.25 |
| B | Sol high | 4 | Nice, but weak colour contrast | 20.5 |
| C | Terra high | 5 | Crashed during play, 0 points | 13.0 |

## AI code reviews (engineering only, blind)

| Reviewer | Ranking |
|---|---|
| Opus 5.5 medium (judge) | Opus > Sol xhigh > Sol high > Hydrogen > Terra |
| Sol high (peer) | Opus > Sol high > Sol xhigh > Hydrogen > Terra |
| Terra high (peer) | Opus > Sol high > Sol xhigh > Hydrogen > Terra |
| Hydrogen high (peer) | Opus > Sol high > Sol xhigh > Hydrogen > Terra |

- **Self-preference flag:** the judge (Opus) ranked Opus first. All three non-Claude peers did the same, so the result is corroborated and not just same-family bias.
- **Peer self-bias:** none visible. Sol high put itself 2nd, Terra put itself last and Hydrogen put itself 4th, each matching the consensus.
- **Authorship guesses:**

  | Peer | Correct | Notes |
  |---|---|---|
  | Hydrogen | 3/5 | Recognised its own build; only swapped Sol high and Sol xhigh |
  | Sol high | 1/5 | Guessed its own build wrong |
  | Terra | 1/5 | Did not recognise its own build |

## Takeaways

- **AI reviewers and the human disagree on Hydrogen again.** In both R04 and R05 the AI reviewers ranked Hydrogen 4th on engineering, while the user ranked it 1st (R04) and 2nd (R05).
- **Opus wrote the code the AI reviewers rated best but finished 3rd for the human.** Its look was liked, but it started slowly and had hiccups.
- **Sol xhigh beat Sol high for the human** (1st vs 4th), while the AI reviewers rated them about equal.
- **Terra crashed during play.** It was also last on engineering in all four AI reviews.
- **Sound:** only Hydrogen added it, unprompted. Worth porting into the winner.

## Cost and time (from RUNS.md)

| Model | Working time | API $ | Retries |
|---|---|---|---|
| Sol high | 163 min | 7.50 | none |
| Sol xhigh | 113 min | 8.12 | none |
| Terra | 58 min | 2.92 | 1 continue |
| Hydrogen | 123 min | 7.19 | 1 crash retry |
| Opus | 107 min | 16.40 | Claude 5-hour-limit retry |

## Follow-ups

- Clean verification of E, then merge it into master.
- Port the procedural sound from D.
- Check the cause of C's crash for the record.
- Remove the R05 worktrees; keep the branches.
