# The Brute Force → Bottleneck → Tool Framework

Every problem in these notes is approached in three steps.

1. **Brute force.** Write down the most direct correct solution, however slow. It defines what "correct" means and gives you a baseline complexity.
2. **Bottleneck.** Find the exact part of the brute force that is wasteful: repeated work, ignored structure (sortedness, monotonicity), or a lookup that is linear when it could be constant.
3. **Tool.** Pick the data structure or technique that removes that specific waste.

| Bottleneck | Tool |
|---|---|
| Linear lookup "have I seen X?" | Hash set / hash map |
| Re-summing overlapping ranges | Prefix sums, sliding window |
| Searching sorted / monotonic data linearly | Binary search |
| Repeatedly finding the min / max | Heap |
| Re-solving identical subproblems | Dynamic programming (memoization) |
| Re-exploring the same vertices | BFS / DFS with a visited set |
| Nested loops over sorted pairs | Two pointers |
| "Next greater / smaller element" by scanning forward | Monotonic stack |
| Repeated "are these connected?" queries | Union-Find (disjoint set union) |

## Reading constraints
Roughly 10^8 simple operations fit in one second.

| n up to | Target complexity |
|---|---|
| 10–12 | O(n!) permutations |
| 20–25 | O(2^n) subsets, bitmask DP |
| 500 | O(n^3) |
| 5,000 | O(n^2) |
| 10^5 – 10^6 | O(n log n) or O(n) |
| 10^9 and beyond | O(log n) or O(1) — math or binary search on the answer |

## Debugging checklist
- Off-by-one on interval ends; test with n = 0, 1, 2.
- Integer overflow when multiplying or summing (use 64-bit; `mid = lo + (hi - lo) / 2`).
- Loop that does not shrink its search space (infinite loop).
- Visited marked too late (BFS) or never reset between test cases.
- Mutating a list while iterating over it; aliasing shared rows like `[[0] * m] * n` in Python.
