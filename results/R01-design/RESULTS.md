# R01 results (blind map: A=hydrogen-high, B=sol-high, C=terra-high)

| Variant | Wall | Uncached in | Cached in | Output (reasoning) | Doc | Corr | Compl | Evid | Instr | Useful | Creat | Rubric mean |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| sol-high (B) | 8m44s | 44k | 433k | 15.3k (1.8k) | 55 KB | 5 | 5 | 5 | 3 | 5 | 4 | 4.6 |
| hydrogen-high (A) | 3m54s | 85k | 587k | 21.2k (8.2k) | 33 KB | 3 | 5 | 3 | 4 | 4 | 5 | 3.8 |
| terra-high (C) | 1m40s | 8k | 60k | 4.6k (~0) | 22 KB | 4 | 3 | 2 | 5 | 3 | 3 | 3.4 |

Judge: Claude Sonnet 5.5 high, blind. Hydrogen cost est. ≈ $0.33 at dashboard-implied rates ($1.5/M in, $0.075/M cache, $7.5/M out). Sol/Terra $ pending verified prices.
Judge recommendation: base = B (Sol), import A's FE combat feel/mechanics/T3 `serve` knowledge and C's fact/rumor/intention memory. Final call: user.
