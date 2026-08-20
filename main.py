from fastapi import FastAPI
from pydantic import BaseModel
import generate

class Query(BaseModel):
    question:str 
    mode: str = "answer"

app = FastAPI()
@app.get("/")
def home():
    return {"message" : "Hello, RAG!"}

@app.post("/ask")
def ask(request: Query):
    result = generate.answer(request.question , request.mode)
    return {"answer" : result}