# Heaps and Greedy Choices

## Brute force
Whenever you need the current smallest (or largest) element, scan the whole collection. O(n) per query, O(n^2) or worse overall. For "top k", sort everything: O(n log n) even when k is tiny.

## Bottleneck
You only ever need the extreme element, but a scan or a full sort maintains far more order than that.

## Tool: a binary heap (priority queue)
A heap keeps just enough order to give the minimum in O(1) and support push / pop in O(log n).

Python's `heapq` is a min-heap. For a max-heap, push negated keys.

```python
import heapq

def k_largest(nums, k):
    heap = []                       # min-heap of the k largest seen so far
    for x in nums:
        heapq.heappush(heap, x)
        if len(heap) > k:
            heapq.heappop(heap)     # evict the smallest of the k+1
    return sorted(heap, reverse=True)
```

That is O(n log k) time and O(k) memory — better than sorting when k is much smaller than n, and it works on streams.

## Patterns
- Merge k sorted lists: push the head of each list; pop the minimum and push its successor. O(N log k).
- Running median: a max-heap for the lower half and a min-heap for the upper half, rebalanced so their sizes differ by at most one.
- Scheduling / meeting rooms: sort by start time; a min-heap of end times tells you whether the earliest-finishing room is free.
- Dijkstra: a heap of (distance, vertex); skip stale entries whose distance is larger than the best known.

## Greedy — and when to trust it
A greedy algorithm commits to the locally best choice. It is correct only when an exchange argument holds: any optimal solution can be transformed into the greedy one without getting worse. Interval scheduling by earliest end time is a correct greedy; coin change with arbitrary denominations is not (see dynamic programming). If you cannot sketch the exchange argument, look for a counterexample before coding.
