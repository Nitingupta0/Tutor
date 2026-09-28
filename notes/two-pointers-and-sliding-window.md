# Two Pointers and Sliding Window

## Brute force
Enumerate every pair (i, j) or every subarray [i, j] and test it. O(n^2) pairs, often O(n^3) if each subarray is re-summed.

## Bottleneck
Adjacent candidates share almost all their work. Subarray [i, j+1] is [i, j] plus one element; re-computing it from scratch throws that away. And when the data is sorted, a failed pair tells you which direction to move — the brute force ignores that information.

## Tool 1: two pointers on sorted data
For "find a pair with sum equal to target" in a sorted array, put `l` at the start and `r` at the end. If the sum is too small, only increasing `l` can help; if too large, only decreasing `r` can help. Each step discards one element for good, so O(n).

```python
def pair_with_sum(a, target):
    l, r = 0, len(a) - 1
    while l < r:
        s = a[l] + a[r]
        if s == target:
            return l, r
        if s < target:
            l += 1
        else:
            r -= 1
    return None
```

3Sum is a loop over the first element plus this two-pointer scan: O(n^2) instead of O(n^3). Skip duplicates to avoid repeated triplets.

## Tool 2: sliding window
Maintain a window [l, r] and a summary of it (a sum, a frequency map, a count of distinct elements). Extend `r` one step at a time; while the window violates the constraint, advance `l`. Each index enters and leaves once, so O(n).

```python
def longest_substring_without_repeats(s):
    last = {}
    best = l = 0
    for r, ch in enumerate(s):
        if ch in last and last[ch] >= l:
            l = last[ch] + 1
        last[ch] = r
        best = max(best, r - l + 1)
    return best
```

## When a sliding window does NOT work
The window needs monotonicity: shrinking a valid window must keep it valid (or growing an invalid one keeps it invalid). With negative numbers, "subarray sum equals k" breaks this — use prefix sums with a hash map of seen prefix values instead: count of subarrays ending at r with sum k equals the count of earlier prefixes equal to prefix[r] - k.
