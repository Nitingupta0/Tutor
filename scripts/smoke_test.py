import requests

url = "http://127.0.0.1:8000/ask"
body = {
    "question": """int lowerBound(vector<int>& a, int target) {
                int left = 0, right = a.size() - 1;
                while (left <= right) {
                int mid = left + (right - left) / 2;
                    if (a[mid] < target) left = mid + 1;
                    else right = mid;
                }
                return left;
                }""",   # your choice — pick a real DSA question
    "mode": "debug",        # "hint", "debug", or "answer"
}

response = requests.post(url, json=body)
data = response.json()
print(data["answer"])
print("\nGrounded in:", ", ".join(source for source, _ in data["sources"]), "(cache hit)" if data["cached"] else "")

