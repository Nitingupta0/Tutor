# Monotonic Stack and Union-Find

## Monotonic stack

### Brute force
For "next greater element" (or daily temperatures, stock span), scan forward from every index until you find a larger value. O(n^2) on a decreasing array.

### Bottleneck
Elements that have been "beaten" by a later, larger value can never be anyone's answer again, yet the brute force keeps re-scanning past them.

### Tool
Keep a stack of indices whose answer is still unknown, with values in decreasing order. When a new value arrives, it is the answer for every smaller value on top of the stack — pop them. Each index is pushed and popped once: O(n).

```python
def next_greater(a):
    ans = [-1] * len(a)
    stack = []                      # indices, values decreasing from bottom to top
    for i, x in enumerate(a):
        while stack and a[stack[-1]] < x:
            ans[stack.pop()] = x
        stack.append(i)
    return ans
```

The same tool gives the largest rectangle in a histogram (for each bar, the nearest smaller bar on both sides) and trapping rain water.

## Union-Find (Disjoint Set Union)

### Brute force
To answer "are u and v connected?" after each edge is added, run a BFS. O(V + E) per query.

### Bottleneck
Connectivity only ever grows when edges are added; recomputing it from scratch throws the previous answer away.

### Tool
Keep a parent pointer per vertex; the root identifies the component. `union` links roots; `find` follows parents, compressing the path as it goes. With union by size and path compression, operations run in near-constant amortized time (inverse Ackermann).

```python
class DSU:
    def __init__(self, n):
        self.parent = list(range(n))
        self.size = [1] * n

    def find(self, x):
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]   # path halving
            x = self.parent[x]
        return x

    def union(self, a, b):
        a, b = self.find(a), self.find(b)
        if a == b:
            return False                                   # already connected: this edge closes a cycle
        if self.size[a] < self.size[b]:
            a, b = b, a
        self.parent[b] = a
        self.size[a] += self.size[b]
        return True
```

Uses: Kruskal's minimum spanning tree, redundant connection (the first edge whose union returns False), number of provinces, accounts merge.
