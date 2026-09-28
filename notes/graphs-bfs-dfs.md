# Graph Traversal: BFS and DFS

## Brute force
Try every path from the source, recursively, without remembering where you have been. Exponential, and it loops forever on cycles.

## Bottleneck
The same vertex is reached along many paths and re-explored every time. Once you know a vertex is reachable (and, for BFS, at what distance), exploring it again adds nothing.

## Tool: traversal with a visited set
Mark each vertex when it is discovered and never push it again. Every vertex and edge is handled once: O(V + E).

### BFS — shortest paths in unweighted graphs
BFS explores in layers, so the first time a vertex is discovered is along a shortest path.

```python
from collections import deque

def bfs(adj, src):
    dist = {src: 0}
    q = deque([src])
    while q:
        u = q.popleft()
        for v in adj[u]:
            if v not in dist:          # mark on push, not on pop
                dist[v] = dist[u] + 1
                q.append(v)
    return dist
```

Marking on pop instead of on push is a common bug: the same vertex is enqueued many times, which can blow up to O(E) queue entries per vertex on dense graphs.

Grid problems are graphs: each cell is a vertex, the 4 neighbours are edges. Multi-source BFS (push all sources at distance 0) solves "rotting oranges" and "distance to nearest 0".

### DFS — structure: components, cycles, ordering
- Connected components / number of islands: start a DFS from every unvisited vertex; each start is a new component.
- Cycle detection in a directed graph: three colours (unvisited, on the current stack, finished). An edge to an "on stack" vertex is a back edge, which means a cycle.
- Topological order: reverse of DFS finishing order, or Kahn's algorithm (repeatedly remove in-degree-0 vertices). If Kahn's algorithm removes fewer than V vertices, there is a cycle — this is course schedule.

Deep recursion in Python hits the recursion limit around 1000 frames; use an explicit stack for large inputs.

## Weighted shortest paths
BFS is only correct when all edges have equal weight. With non-negative weights use Dijkstra (a min-heap keyed by distance); with 0/1 weights use 0-1 BFS with a deque; with negative edges use Bellman-Ford.
