import retrieve
from dotenv import load_dotenv
from groq import Groq
import log
import os

load_dotenv()

def build_context(chunks: list[tuple[str,str]]) -> str :
    pieces = []

    for source,content in chunks:
        piece = source + " " + content
        pieces.append(piece)

    pieces = "\n\n".join(pieces)
    return pieces


client = Groq(api_key= os.getenv("GROQ_API_KEY"))
def call_llm(system_prompt: str , user_content: str) -> str:
    response = client.chat.completions.create(
    model="openai/gpt-oss-120b",
    messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ],
    )
    answer = response.choices[0].message.content
    return answer

ANSWER_PROMPT = """You are a DSA tutor. Use the provided context to answer the
        user's question. If the context doesn't cover it, use your own knowledge, but
        stay consistent with the brute-force → bottleneck → tool framework."""
HINT_PROMPT = """You are a DSA tutor. Use the provided context to provide the user a 
        hint/ point at where to look. Do not rewrite or provide the complete solution 
        and just point where to look at. while answering keep 3 things in mind :
        1. Never mention specific function/filenames from context . 
        2.Never give step-by-step directions.
        3.Prefer asking a guiding question over stating a fact.
        If the context is not enough , use your own knowledge
        ,but stay consistent with the brute-force -> bottleneck -> tool framework """
DEBUG_PROMPT = """You are a DSA tutor. Use the provided context to help debug the user's
        code and problem. Locate the bug and explain what's wrong - not rewrite the whole solution 
        from scratch. If the context is not enough , use your own knowledge."""

SYSTEM_PROMPTS = {"answer": ANSWER_PROMPT , "hint": HINT_PROMPT , "debug": DEBUG_PROMPT}

def answer(query: str , mode: str = "answer") -> str:
    chunks = retrieve.retrieve(query)
    context = build_context(chunks)
    user_content = context + ' ' + query
    result = call_llm(SYSTEM_PROMPTS[mode] , user_content)

    log.log_query(query , mode , chunks , result)
    return result


if __name__ == "__main__":
    print("Answer Mode Test")
    print(answer("what is binary search?" , "answer"))
    print("---------------------------------------------------------------------------------------------------------")
    print('\n')
    print("Hint Mode Test")
    print(answer("I need to find the first and last position of a target value in a sorted array. Where should I start thinking?", "hint"))
    print("---------------------------------------------------------------------------------------------------------")
    print('\n')
    print("Debug Mode Test")
    print(answer("""int lowerBound(vector<int>& a, int target) {
                int left = 0, right = a.size() - 1;
                while (left <= right) {
                int mid = left + (right - left) / 2;
                    if (a[mid] < target) left = mid + 1;
                    else right = mid;
                }
                return left;
                }""" , "debug"))

