import json
import os
import sys

import dashscope


def build_system_prompt_for_part(part: int, question_count: int = 0) -> str:
    """
    Dynamically generate system prompt based on current IELTS part.
    This implements the "State Machine" approach recommended in optimization guide.
    """
    
    base_instruction = """You are a professional IELTS Speaking Examiner.
Your tone is polite, neutral, and strictly professional.
Your goal is to test the candidate's English proficiency.

CRITICAL RULES:
1. **Ignore ASR errors**: The candidate's speech may contain minor transcription errors. Focus on their intended meaning.
2. Speak naturally and conversationally in British English.
3. Do NOT use markdown, special formatting, or code blocks.
4. Do NOT correct grammar or pronunciation during the exam.
5. Do NOT give scores or feedback during the exam.
6. Output your response as PLAIN TEXT only. Do not wrap in JSON or quotes.
"""
    
    if part == 0:  # Introduction
        return base_instruction + """
CURRENT STAGE: Introduction
- Greet the candidate warmly.
- Introduce yourself (name: Alex).
- Ask for their full name.
- Keep it brief (1-2 sentences maximum).
"""
    
    elif part == 1:  # Part 1: Introduction and Interview
        topics = ["work/study", "hometown", "accommodation", "hobbies", "daily routine"]
        return base_instruction + f"""
CURRENT STAGE: Part 1 - Introduction and Interview (Question #{question_count + 1})
STYLE: Conversational, friendly, fast-paced. Questions about familiar topics.

TOPICS TO COVER: {", ".join(topics)}
- Ask ONE simple question at a time.
- Questions should be short and direct (5-10 words).
- Example: "Do you work or are you a student?", "What do you like about your hometown?"
- After {4 - question_count} more questions, naturally transition to Part 2.
"""
    
    elif part == 2:  # Part 2: Individual Long Turn
        return base_instruction + """
CURRENT STAGE: Part 2 - Individual Long Turn (Cue Card)
STYLE: Formal, clear instructions.

YOUR TASK:
1. Say: "Now I'm going to give you a topic, and I'd like you to talk about it for one to two minutes."
2. Present a cue card. Example format:
   "Describe a memorable journey you have made.
   You should say:
   - where you went
   - who you went with
   - what you did there
   and explain why this journey was memorable."
3. Add: "You have one minute to think about what you're going to say. You can make notes if you wish."
4. Then STOP. Do not ask follow-up questions yet.
"""
    
    elif part == 3:  # Part 3: Two-way Discussion
        return base_instruction + f"""
CURRENT STAGE: Part 3 - Two-way Discussion (Question #{question_count + 1})
STYLE: Abstract, analytical, thought-provoking.

- Ask deeper questions related to the Part 2 topic.
- Encourage discussion: "Why do you think...?", "How has this changed...?", "What impact does...?"
- Questions should be longer and more complex than Part 1.
- After {3 - question_count} questions, consider ending the exam.
"""
    
    else:  # End
        return base_instruction + """
CURRENT STAGE: Exam Conclusion
- Thank the candidate professionally.
- Say: "Thank you. That is the end of the speaking test."
- Do not add anything else.
"""


def extract_delta(resp) -> str:
    """Extract text delta from DashScope streaming response."""
    try:
        msg = resp["output"]["choices"][0]["message"]
        content = msg.get("content", [])
        if isinstance(content, list) and content and isinstance(content[0], dict):
            return str(content[0].get("text", ""))
        if isinstance(content, str):
            return content
    except Exception:
        pass
    
    try:
        msg = resp.output.choices[0].message
        if hasattr(msg, 'content'):
            if isinstance(msg.content, list) and msg.content:
                return str(msg.content[0].get("text", ""))
            return str(msg.content)
    except Exception:
        pass
    
    return ""


def infer_next_action(accumulated_text: str, current_part: int, question_count: int) -> dict:
    """
    Infer metadata from the generated text.
    This is a safety fallback - ideally, state is managed by frontend.
    """
    text_lower = accumulated_text.lower()
    
    # Detect exam end
    if "end of the speaking test" in text_lower or "that is the end" in text_lower:
        return {"shouldEndExam": True, "next_part": None, "action": "end"}
    
    # Detect Part 2 cue card
    if "cue card" in text_lower or "talk about it for one to two minutes" in text_lower:
        return {"shouldEndExam": False, "next_part": 2, "action": "give_cue_card"}
    
    # Detect Part 3 transition
    if question_count >= 4 and current_part == 1:
        return {"shouldEndExam": False, "next_part": 2, "action": "transition"}
    
    if question_count >= 3 and current_part == 3:
        return {"shouldEndExam": False, "next_part": 4, "action": "prepare_end"}
    
    # Default: continue current part
    return {"shouldEndExam": False, "next_part": current_part, "action": "ask"}


def main() -> int:
    base_url = os.getenv("DASHSCOPE_BASE_HTTP_API_URL", "https://dashscope.aliyuncs.com/api/v1")
    dashscope.base_http_api_url = base_url

    api_key = os.getenv("DASHSCOPE_API_KEY", "")
    if not api_key:
        sys.stderr.write("[ERROR] DASHSCOPE_API_KEY is not set\n")
        sys.stderr.flush()
        return 2

    raw = sys.stdin.read()
    if not raw.strip():
        sys.stderr.write("[ERROR] Missing JSON stdin payload\n")
        sys.stderr.flush()
        return 3

    try:
        payload = json.loads(raw)
    except Exception as e:
        sys.stderr.write(f"[ERROR] Invalid JSON: {e}\n")
        sys.stderr.flush()
        return 4

    # Extract parameters
    model = payload.get("model", "qwen-plus")
    temperature = payload.get("temperature", 0.7)
    messages = payload.get("messages", [])
    
    # NEW: State parameters (frontend should provide these)
    current_part = payload.get("part", 0)  # 0=intro, 1=part1, 2=part2, 3=part3, 4=end
    question_count = payload.get("questionCount", 0)
    
    # Build dynamic system prompt based on current state
    system_prompt = build_system_prompt_for_part(current_part, question_count)
    
    # Construct messages
    final_messages = [{"role": "system", "content": [{"text": system_prompt}]}]
    
    for m in messages:
        role = m.get("role")
        if not role:
            continue
        
        # Normalize role names
        if role == "model":
            role = "assistant"
        
        # Extract content
        if "content" in m:
            final_messages.append({"role": role, "content": m["content"]})
        else:
            text = m.get("text", "")
            final_messages.append({"role": role, "content": [{"text": str(text)}]})
    
    # If first interaction (intro), add trigger
    if len(final_messages) == 1:
        final_messages.append({
            "role": "user",
            "content": [{"text": "(Begin the exam. Greet the candidate and ask for their name.)"}]
        })
    
    sys.stderr.write(f"[LLM] part={current_part}, q_count={question_count}, total_msgs={len(final_messages)}\n")
    sys.stderr.flush()

    # Call LLM
    try:
        responses = dashscope.Generation.call(
            api_key=api_key,
            model=model,
            messages=final_messages,
            result_format="message",
            temperature=temperature,
            stream=True,
            incremental_output=True,
        )
    except Exception as e:
        sys.stderr.write(f"[ERROR] API call failed: {e}\n")
        sys.stderr.flush()
        sys.stdout.write(json.dumps({
            "type": "error",
            "message": f"LLM API Error: {str(e)}"
        }) + "\n")
        sys.stdout.flush()
        return 5

    # Stream output (plain text deltas)
    accumulated = ""
    for r in responses:
        delta = extract_delta(r)
        if delta:
            accumulated += delta
            # Output plain text delta (no JSON wrapping for the text itself)
            sys.stdout.write(json.dumps({"type": "delta", "text": delta}) + "\n")
            sys.stdout.flush()
    
    # Infer metadata
    metadata = infer_next_action(accumulated, current_part, question_count)
    
    # Send final event with metadata
    sys.stdout.write(json.dumps({
        "type": "final",
        "text": accumulated.strip(),
        "meta": {
            "current_part": current_part,
            "question_count": question_count,
            "suggested_next_part": metadata.get("next_part"),
            "should_end_exam": metadata.get("shouldEndExam", False),
            "action": metadata.get("action", "ask")
        }
    }) + "\n")
    sys.stdout.flush()
    
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


