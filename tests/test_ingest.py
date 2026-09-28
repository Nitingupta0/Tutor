import pytest

from ingest import chunk_text, load_documents


def words(n):
    return " ".join(f"w{i}" for i in range(n))


def test_short_text_is_one_chunk():
    assert chunk_text(words(10), 200, 50) == [words(10)]


def test_empty_text_has_no_chunks():
    assert chunk_text("", 200, 50) == []


def test_windows_overlap_by_the_requested_amount():
    chunks = chunk_text(words(350), 200, 50)
    assert len(chunks) == 2
    first, second = chunks[0].split(), chunks[1].split()
    assert len(first) == 200
    assert first[-50:] == second[:50]
    assert second[-1] == "w349"


def test_no_trailing_chunk_that_is_a_subset_of_the_previous_one():
    # 200 words fit in exactly one window; the old loop also emitted words 150..199 again.
    assert len(chunk_text(words(200), 200, 50)) == 1


def test_every_word_is_covered():
    text = words(1234)
    covered = set()
    for chunk in chunk_text(text, 200, 50):
        covered.update(chunk.split())
    assert covered == set(text.split())


def test_overlap_must_be_smaller_than_chunk():
    with pytest.raises(ValueError):
        chunk_text(words(10), 50, 50)


def test_load_documents_reads_supported_files_recursively(tmp_path):
    (tmp_path / "a.md").write_text("alpha", encoding="utf-8")
    (tmp_path / "sub").mkdir()
    (tmp_path / "sub" / "b.rst").write_text("beta", encoding="utf-8")
    (tmp_path / "c.png").write_bytes(b"\x89PNG")

    assert load_documents(tmp_path) == [("a.md", "alpha"), ("sub/b.rst", "beta")]


def test_bundled_notes_exist():
    docs = load_documents("notes")
    assert len(docs) >= 5
    assert all(text.strip() for _, text in docs)
