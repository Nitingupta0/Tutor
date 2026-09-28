# Dynamic Programming

## Brute force
Write the recursion that tries every choice: take or skip this item, go right or go down, cut here or not. It is correct but exponential.

## Bottleneck
The recursion tree solves the same subproblem many times. `fib(n)` calls `fib(n-2)` twice, `fib(n-3)` three times, and so on. When the number of distinct subproblems is small (polynomial), the repetition is pure waste.

## Tool: memoize the distinct states
1. Define the state: the smallest set of parameters that determines the answer of a subproblem (an index, a remaining capacity, a last-used element).
2. Write the transition: how a state's answer is built from smaller states.
3. Base cases.
4. Cache (top-down memoization) or fill a table in dependency order (bottom-up).

Cost is (number of states) × (work per transition).

```python
from functools import lru_cache

def coin_change(coins, amount):
    @lru_cache(maxsize=None)
    def best(rem):                      # state: remaining amount
        if rem == 0:
            return 0
        if rem < 0:
            return float("inf")
        return 1 + min(best(rem - c) for c in coins)
    ans = best(amount)
    return -1 if ans == float("inf") else ans
```

## Recognising DP
- "Count the number of ways", "minimum / maximum cost", "is it possible" over a sequence of choices.
- Greedy looks tempting but a counterexample exists (coins 1, 3, 4 and amount 6: greedy takes 4+1+1, optimal is 3+3).

## Classic state shapes
- Prefix: `dp[i]` = answer for the first i elements (house robber, longest increasing subsequence in O(n^2)).
- Two sequences: `dp[i][j]` over prefixes of both (edit distance, longest common subsequence).
- Knapsack: `dp[i][w]` = best value using the first i items with capacity w. For 0/1 knapsack in one dimension, iterate w downwards so each item is used once.
- Interval: `dp[l][r]` over a subarray, filled by increasing length (burst balloons, matrix chain).
- Grid: `dp[r][c]` from the top and left neighbours (unique paths, minimum path sum).

## Space optimisation
If row i only depends on row i-1, keep two rows (or one, with the right iteration direction).
