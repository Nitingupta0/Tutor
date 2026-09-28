# Binary Search

## Brute force
Scan the array left to right and stop at the first element that satisfies the condition. O(n) per query.

## Bottleneck
The linear scan ignores structure: if the array is sorted (or, more generally, if a predicate is monotonic — false, false, ..., true, true), every comparison can rule out half of the remaining candidates, but a scan rules out only one.

## Tool: binary search on a monotonic predicate
Keep an interval that is guaranteed to contain the answer and halve it each step. O(log n).

Think in terms of a predicate `ok(i)` that flips from false to true exactly once. You are searching for the first index where it becomes true.

```cpp
// first index i in [0, n) with a[i] >= target; returns n if none (lower_bound)
int lowerBound(const vector<int>& a, int target) {
    int lo = 0, hi = a.size();          // half-open interval [lo, hi)
    while (lo < hi) {
        int mid = lo + (hi - lo) / 2;   // avoids overflow of lo + hi
        if (a[mid] < target) lo = mid + 1;
        else hi = mid;
    }
    return lo;
}
```

## Invariants to keep straight
- Pick one interval convention and stick to it. Half-open `[lo, hi)` pairs with `while (lo < hi)` and `hi = mid`. Closed `[lo, hi]` pairs with `while (lo <= hi)` and `hi = mid - 1`.
- Mixing conventions is the classic bug: `hi = a.size() - 1` with `while (lo <= hi)` and `hi = mid` loops forever when `lo == hi` and the predicate is true, because the interval never shrinks.
- Every iteration must shrink the interval. Check the two-element case by hand.
- `upper_bound` is the same code with `a[mid] <= target`.

## First and last position of a target
First position is `lowerBound(target)`. Last position is `upperBound(target) - 1`. If `lowerBound` returns n or `a[lo] != target`, the target is absent.

## Binary search on the answer
When the question is "what is the minimum X such that it is possible to ...", and feasibility is monotonic in X, binary search over X and write a `feasible(X)` check. Examples: minimum ship capacity to deliver packages in D days, Koko eating bananas, minimum largest subarray sum when splitting into k parts. Cost is O(log(range) * cost of feasible).
