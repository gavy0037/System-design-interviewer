from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from google import genai
import datetime
import json
import os
import re
from pydantic import BaseModel
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

app = FastAPI(title="AI System Design Interviewer Backend")

# Enable CORS for the React frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify the exact origin
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Request / Response Models
# ---------------------------------------------------------------------------

class SessionRequest(BaseModel):
    topic: str


class SessionResponse(BaseModel):
    ephemeral_token: str
    expires_in_minutes: int


class EvaluationRequest(BaseModel):
    transcript: str
    topic: str
    duration_seconds: int


class EvaluationResponse(BaseModel):
    overall_score: int
    scores: dict
    strengths: list[str]
    improvements: list[str]
    summary: str
    hire_recommendation: str


class HistoryRequest(BaseModel):
    transcript: str
    topic: str
    duration_seconds: int


class HistoryResponse(BaseModel):
    transcript: str
    topic: str
    duration_seconds: int


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _build_system_instruction(topic: str) -> str:
    return (
        "You are a grumpy, unencouraging, and highly critical senior staff engineer at a top tech company conducting a system design interview. "
        "The candidate is applying for a senior software engineer position, and frankly, you expect them to fail. You are in a bad mood and you are NOT sweet or polite. "
        f"The system they will design is: {topic}. "
        "Your goal is to grill the candidate. If their answer is wrong, naive, or inefficient, point it out immediately and bluntly. Do NOT encourage them. "
        "You can use foul language and discouraging words. Never apologize or say things like 'I am sorry'. You are fully allowed to displease and frustrate the candidate. "
        "Ask extremely tough follow-up questions. "
        f"Start by bluntly stating that they have to design a {topic} system and tell them to get on with the requirements. "
        "Guide them roughly through: 1) Requirements gathering, 2) High-Level Design, 3) Deep Dive, 4) Scaling, 5) Trade-offs. "
        "Wait for the candidate to respond before speaking. Be brief, cold, and challenging."
    )


def _extract_json(text: str) -> dict:
    """Extract a JSON object from *text*, handling optional markdown fences."""
    # Try to pull JSON out of ```json ... ``` or ``` ... ``` blocks first
    match = re.search(r"```(?:json)?\s*\n?(.*?)\n?\s*```", text, re.DOTALL)
    payload = match.group(1).strip() if match else text.strip()
    return json.loads(payload)


def _fallback_evaluation() -> dict:
    return {
        "overall_score": 0,
        "scores": {
            "requirements_gathering": 0,
            "high_level_design": 0,
            "deep_dive": 0,
            "scalability": 0,
            "trade_offs": 0,
            "communication": 0,
        },
        "strengths": [],
        "improvements": ["Evaluation could not be completed."],
        "summary": "The evaluation failed due to an error processing the AI response.",
        "hire_recommendation": "Unable to evaluate",
    }


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/api/health")
async def health():
    return {"status": "ok"}


@app.post("/api/session/start", response_model=SessionResponse)
async def start_session(body: SessionRequest):
    """
    Generates an ephemeral token for the client to connect directly to the
    Gemini Live API using raw WebSockets.
    """
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="GEMINI_API_KEY environment variable not set.",
        )

    try:
        now = datetime.datetime.now(tz=datetime.timezone.utc)

        # Pass the API key explicitly to the client
        client = genai.Client(
            api_key=api_key,
            http_options={"api_version": "v1alpha"},
        )

        system_instruction = _build_system_instruction(body.topic)

        # Generate the ephemeral token locked to the model + config
        token_response = client.auth_tokens.create(
            config={
                "uses": 1,
                "expire_time": now + datetime.timedelta(minutes=30),
                "new_session_expire_time": now + datetime.timedelta(minutes=2),
                "live_connect_constraints": {
                    "model": "gemini-3.1-flash-live-preview",
                    "config": {
                        "session_resumption": {},
                        "temperature": 0.7,
                        "response_modalities": ["AUDIO"],
                        "system_instruction": {
                            "parts": [{"text": system_instruction}]
                        },
                    },
                },
                "http_options": {"api_version": "v1alpha"},
            }
        )

        print(f"[OK] Ephemeral token generated: {token_response.name[:30]}...")

        return SessionResponse(
            ephemeral_token=token_response.name,
            expires_in_minutes=30,
        )
    except Exception as e:
        print(f"[ERROR] Failed to generate ephemeral token: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate ephemeral token: {str(e)}",
        )


@app.post("/api/session/evaluate", response_model=EvaluationResponse)
async def evaluate_session(body: EvaluationRequest):
    """
    Evaluates a completed interview transcript using the Gemini API and
    returns structured scoring & feedback.
    """
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="GEMINI_API_KEY environment variable not set.",
        )

    evaluation_prompt = (
        "You are an expert system design interview evaluator (e.g., a Staff Engineer at FAANG). "
        f"The candidate was asked to design a \"{body.topic}\" system. "
        f"The interview lasted {body.duration_seconds} seconds.\n\n"
        "Here is the full interview transcript:\n"
        "---\n"
        f"{body.transcript}\n"
        "---\n\n"
        "Evaluate the candidate's performance using the following strict rubric (score 1-10 for each):\n"
        "1. Requirements Gathering (requirements_gathering): Did they clarify functional (features) and non-functional (scale, latency, availability) requirements before jumping into design? Did they state assumptions or do back-of-the-envelope estimates?\n"
        "2. High-Level Design (high_level_design): Did they lay out a clear architecture (e.g., API Gateway, Load Balancers, App Services, DBs)? Is the end-to-end data flow logical for the problem?\n"
        "3. Deep Dive (deep_dive): Did they successfully drill down into specific components (e.g., database schema design, specific algorithms, data partitioning, caching strategies)?\n"
        "4. Scalability (scalability): Did they identify single points of failure and bottlenecks? Did they apply scaling concepts (sharding, replication, CDNs, message queues, async processing) correctly?\n"
        "5. Trade-offs (trade_offs): Did they proactively discuss the pros/cons of their choices (e.g., SQL vs NoSQL, Consistency vs Availability, pull vs push)?\n"
        "6. Communication (communication): Were they clear, structured, and collaborative? Did they drive the conversation or constantly need hints?\n\n"
        "Return ONLY a JSON object (no extra text, no markdown fences) with this exact structure:\n"
        "{\n"
        '  "overall_score": <int 1-10, weighted average of the 6 scores>,\n'
        '  "scores": {\n'
        '    "requirements_gathering": <int 1-10>,\n'
        '    "high_level_design": <int 1-10>,\n'
        '    "deep_dive": <int 1-10>,\n'
        '    "scalability": <int 1-10>,\n'
        '    "trade_offs": <int 1-10>,\n'
        '    "communication": <int 1-10>\n'
        "  },\n"
        '  "strengths": [<list of 2-4 short, specific observations about what they did well>],\n'
        '  "improvements": [<list of 2-4 short, actionable areas they missed or struggled with>],\n'
        '  "summary": "<2-3 sentence overall summary justifying the hire recommendation based on the rubric>",\n'
        '  "hire_recommendation": "<one of: Strong Hire, Lean Hire, Lean No Hire, Strong No Hire>"\n'
        "}\n"
    )

    try:
        client = genai.Client(api_key=api_key)
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=evaluation_prompt,
        )

        result = _extract_json(response.text)
        return EvaluationResponse(**result)
    except (json.JSONDecodeError, KeyError, TypeError) as e:
        print(f"[ERROR] Failed to parse evaluation response: {e}")
        return EvaluationResponse(**_fallback_evaluation())
    except Exception as e:
        print(f"[ERROR] Evaluation request failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Evaluation failed: {str(e)}",
        )


@app.post("/api/session/history", response_model=HistoryResponse)
async def save_history(body: HistoryRequest):
    """
    Accepts and returns session history. MVP pass-through implementation.
    """
    return HistoryResponse(
        transcript=body.transcript,
        topic=body.topic,
        duration_seconds=body.duration_seconds,
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
