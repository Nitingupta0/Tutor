import pytest

from corpus import codeforces, stackoverflow

PAYLOAD = {
    "status": "OK",
    "result": {
        "problems": [
            {"contestId": 4, "index": "A", "name": "Watermelon", "type": "PROGRAMMING", "rating": 800, "tags": ["math"]},
            {"contestId": 1850, "index": "B", "name": "Ten Words", "type": "PROGRAMMING", "rating": 1400, "tags": []},
            {"contestId": 9999, "index": "C", "name": "Unrated", "type": "PROGRAMMING", "tags": ["dp"]},
            {"problemsetName": "acmsguru", "index": "100", "name": "No contest", "tags": []},
        ]
    },
}


def test_codeforces_parse():
    rows = codeforces.parse_problems(PAYLOAD)
    assert [r["ext_id"] for r in rows] == ["4A", "1850B", "9999C"]
    assert rows[0] == {
        "source": "codeforces", "ext_id": "4A", "title": "Watermelon",
        "url": "https://codeforces.com/problemset/problem/4/A", "tags": ["math"], "rating": 800,
    }


def test_codeforces_rating_filter_and_limit():
    assert [r["ext_id"] for r in codeforces.parse_problems(PAYLOAD, min_rating=1000)] == ["1850B"]
    assert [r["ext_id"] for r in codeforces.parse_problems(PAYLOAD, max_rating=1000)] == ["4A"]
    assert len(codeforces.parse_problems(PAYLOAD, limit=1)) == 1


def test_codeforces_api_error():
    with pytest.raises(ValueError, match="limit exceeded"):
        codeforces.parse_problems({"status": "FAILED", "comment": "Call limit exceeded"})


POSTS = """<?xml version="1.0" encoding="utf-8"?>
<posts>
  <row Id="1" PostTypeId="1" AcceptedAnswerId="2" Score="42" Title="Why is binary search log n?"
       Body="&lt;p&gt;I use &lt;code&gt;mid&lt;/code&gt; and it is fast.&lt;/p&gt;" Tags="&lt;algorithm&gt;&lt;binary-search&gt;" />
  <row Id="2" PostTypeId="2" ParentId="1" Score="50"
       Body="&lt;p&gt;Each step halves n.&lt;/p&gt;&lt;pre&gt;&lt;code&gt;while lo &amp;lt; hi:&lt;/code&gt;&lt;/pre&gt;" />
  <row Id="3" PostTypeId="1" AcceptedAnswerId="4" Score="99" Title="CSS centering" Body="&lt;p&gt;x&lt;/p&gt;" Tags="|css|" />
  <row Id="4" PostTypeId="2" ParentId="3" Score="10" Body="&lt;p&gt;flex&lt;/p&gt;" />
  <row Id="5" PostTypeId="1" AcceptedAnswerId="6" Score="1" Title="Low score" Body="&lt;p&gt;x&lt;/p&gt;" Tags="|algorithm|" />
  <row Id="6" PostTypeId="2" ParentId="5" Score="1" Body="&lt;p&gt;y&lt;/p&gt;" />
</posts>
"""


def test_parse_tags_handles_both_dump_formats():
    assert stackoverflow.parse_tags("<algorithm><binary-search>") == ["algorithm", "binary-search"]
    assert stackoverflow.parse_tags("|css|flexbox|") == ["css", "flexbox"]


def test_html_to_text_keeps_code_blocks():
    text = stackoverflow.html_to_text("<p>Use <code>x</code>.</p><pre><code>a &lt; b</code></pre>")
    assert "`x`" in text
    assert "```\na < b\n```" in text


def test_stackoverflow_export(tmp_path):
    posts = tmp_path / "Posts.xml"
    posts.write_text(POSTS, encoding="utf-8")
    out = tmp_path / "out"

    assert stackoverflow.export(posts, out, tags=["algorithm"], min_score=10) == 1

    note = (out / "so-1.md").read_text(encoding="utf-8")
    assert note.startswith("# Why is binary search log n?")
    assert "https://stackoverflow.com/questions/1" in note
    assert "CC BY-SA" in note
    assert "Each step halves n." in note
    assert "while lo < hi:" in note
