# Script — Multi-Speaker Talk Radio Generation

Transforms Reddit posts and comment threads into structured call-in talk radio dialogue scripts using LLM completion.

## Public API

No HTTP routes. Implements `ScriptContract` (`generateScript(post, comments): Promise<ScriptData>`). Injected by `QueueService`.

## 2-Stage Script Generation Pipeline

1. **Stage 1: Outline Generation (`STAGE1_OUTLINE_SYSTEM_PROMPT`)**:
   - Analyzes post title, selftext, and comment reply chains.
   - Generates structured Markdown outline with 4 steps:
     - **Step 1**: Host Intro & Hook with dynamic component ordering (Lead-in, Hook, Caller name/location, Line number).
     - **Step 2**: Caller narrative beats (3–4 key points).
     - **Step 3**: Room stances for co-hosts (Mike's pragmatic take, Sarah's empathetic take, Jenny's wildcard fresh take).
     - **Step 4**: Final verdict and line-drop phrase.
   - Validates that all 4 steps exist in LLM output via `validateOutline()`.

2. **Stage 2: Dialogue Synthesis (`STAGE2_DIALOGUE_SYSTEM_PROMPT`)**:
   - Converts the Stage 1 Outline and source material into rapid-fire multi-speaker dialogue.
   - Format: `[Speaker Name]: Spoken text.`
   - Allowed speakers: `Dave`, `Sarah`, `Mike`, `Jenny`, `Caller`.
   - Validates speaker tokens and checks minimum turns ($\ge 5$).
   - Embeds sound effect cues: `[laughs]`, `[pauses]`, `[Line Cut Sound]`.
