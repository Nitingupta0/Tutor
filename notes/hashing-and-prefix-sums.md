# Hashing and Prefix Sums

## Brute force
For each element, look back over everything before it: "have I seen the complement?", "what is the sum of a[i..j]?". O(n) per lookup, O(n^2) total.

## Bottleneck
The same question is asked about overlapping data over and over. The answers can be precomputed once or remembered as you go.

## Tool 1: hash map of what you have seen
Two Sum on unsorted input: walk left to right, and for each x check whether `target - x` is already in a map from value to index. Average O(1) lookup, O(n) total. Works for any "find an earlier element with property P" question where P can be expressed as an exact key.

Frequency counting (anagrams, majority element, first unique character) is the same tool: a map from key to count.

## Tool 2: prefix sums
Define `pre[0] = 0` and `pre[i+1] = pre[i] + a[i]`. Then the sum of `a[l..r]` is `pre[r+1] - pre[l]` in O(1) after O(n) setup.

```python
def subarray_sum_equals_k(a, k):
    count = 0
    seen = {0: 1}           # prefix value -> how many times it has occurred
    running = 0
    for x in a:
        running += x
        count += seen.get(running - k, 0)
        seen[running] = seen.get(running, 0) + 1
    return count
```

Combining the two tools handles negative numbers, which sliding windows cannot.

## Variants
- 2D prefix sums: `P[i+1][j+1] = a[i][j] + P[i][j+1] + P[i+1][j] - P[i][j]`, rectangle sums by inclusion-exclusion.
- Difference arrays: to add v to every element of [l, r] many times, do `d[l] += v; d[r+1] -= v` and take one prefix sum at the end.
- Prefix XOR, prefix counts modulo k (subarrays divisible by k) follow the same pattern.
