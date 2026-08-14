# Social Radio — Call-In Script Structure & Generation Blueprint

This document outlines the architecture, data mappings, dialogue rules, and prompt strategies for generating natural, radio-authentic call-in segments for Social Radio.

---

## 1. The Core 4-Step Segment Structure

Social Radio models a real-world talk radio call-in show (e.g., *Loveline*, *Car Talk*, *Therapy Gecko*). The Guest Caller (representing the Reddit Post OP) calls into the station to discuss their dilemma with a panel of co-hosts (Dave, Sarah, Mike, Jenny).

```
[Step 1: Host Intro & Hook] ➔ [Step 2: Caller Explains Details] ➔ [Step 3: Room Debate & Gap Angles] ➔ [Step 4: Quick Drop & Reset]
```

---

### Step 1: Host Intro & Hook (Overview)
- **Data Source**: Reddit Post Title + main dilemma from Post Body (summarized into natural spoken host language).
- **Function**: Host hooks the audience, introduces the story's core premise, and drops the line/caller.
- **Rules**: Zero corporate greetings (*"Welcome back"*, *"Today we discuss"*). Must fulfill 3 required data slots: `[Original Hook Angle] + [Caller Name & City] + [Line N]`.

> **Example:**
> - **Dave (Host):** *"Next up, we've got a wild story about a 70% rent demand over a private bathroom. Alex from Wollongong is on Line 2 with us."*

---

### Step 2: Caller Explains Details (Elaboration)
- **Data Source**: Reddit Post Body (used as context/guide for the caller's narrative).
- **Function**: Caller (OP) comes on the line and explains the situation in conversational bites.
- **Rules**: Caller jumps straight into the emotional dilemma. Co-hosts interject with micro-reactions (`[laughs]`, `[interrupting]`, `"Wait, what?"`, `"Are you serious?"`) and clarifying questions.

> **Example:**
> - **Caller (Alex):** *"Hey Dave, so my roommate just handed me an itemized spreadsheet claiming I owe 70% of the rent for our two-bedroom..."*
> - **Sarah (Host):** *"70%?! Is the second bedroom a broom closet?"*
> - **Caller (Alex):** *"No! It's identical, mine just has its own small en-suite bathroom!"*

---

### Step 3: Room Debate & Unexplored Angles (Discussion)
- **Data Source**: Reddit Comment Threads + LLM-Generated Gap Angles.
- **Function**: Co-hosts debate the dilemma using Reddit comment stances as their own opinions. The LLM injects 1–2 unexplored "gap angles" (talking points missed by the comments).
- **Rules**: The Caller stays active on the line, reacting, clarifying, and pushing back against host takes.

> **Example:**
> - **Mike (Host - Reddit Comment Stance):** *"Look, an en-suite is nice, but 70/30 is extortion. Did you sign a 50/50 lease?"*
> - **Sarah (Host - Counter Reddit Stance):** *"If you have private plumbing, you should pay a bit more. Maybe 55/45."*
> - **Jenny (Host - LLM Gap Angle):** *"Wait guys, why is he springing this on you 3 months in? Did he lose his job?"*
> - **Caller (Alex):** *"Actually... yeah, he got laid off two weeks ago..."*
> - **Dave (Host):** *"Aha! There it is!"*

---

### Step 4: Quick Drop & Reset (Outro)
- **Data Source**: Host Resolution & Queue Transition.
- **Function**: Hosts deliver a fast, sharp verdict/advice, drop the caller off the line without stiff formalities (`"Line 2 clear"`), and reset/pivot to the next segment.

> **Example:**
> - **Dave (Host):** *"Alex, pay 55% max or tell him to swap rooms. Good luck mate. Line 2 clear."*
> - **[Line Cut Sound / Click]**
> - **Dave (Host):** *"Man, spreadsheets in a roommate situation? Immediate red flag. Up next..."*

---

## 2. Reddit Data to Script Mapping

| Segment Step | Primary Reddit Data Source | LLM Role / Transformation |
| :--- | :--- | :--- |
| **Step 1: Host Intro** | Post Title + Post Body Teaser | Rephrase into a 1-sentence dramatic radio hook + slot caller/line info. |
| **Step 2: Caller Details** | Post Body | Guide for Caller's narrative + host micro-reactions & questions. |
| **Step 3: Room Debate** | Top Comments & Nested Reply Threads | Transform comment stances into host debate positions + synthesize unexplored gap angles. |
| **Step 4: Quick Drop** | End of Segment | Generate quick host verdict, line drop phrase, and room reset. |

---

## 3. To-Be-Experimented Strategies (Hook Generation)

We are experimenting with two approaches for generating Step 1 (Host Intro): **Approach A (On-the-Fly Dynamic Generation)** and **Approach B (Preset 10 Archetypes Rotation)**.

### Approach A: Dynamic Zero-Shot Hook Framing (Primary Choice)

Prompt the LLM to invent an original, context-aware Radio Hook Angle on the fly based on the specific emotion of the Reddit post.

#### Prompting Instruction Rule:
```markdown
[STEP 1: HOST INTRO RULE]
Invent an original, high-energy Radio Hook Angle tailored specifically to the drama/emotion of the story. Never use generic corporate greetings ("Welcome back", "Today we discuss", "How are you").

Your intro must fulfill 3 required data slots in a single fluid breath:
1. [Original Dramatic Hook Angle] (e.g. host-to-host gossip, moral dilemma, outraged hot-take, audience challenge, disbelief, secret confession)
2. [Caller Name & City] (e.g., Alex from Wollongong)
3. [Line Number] (e.g., Line 2)
```

---

### Approach B: Preset 10 Radio Intro Archetypes (Fallback Choice)

If Approach A produces repetitive hooks, we can pass a randomly selected `archetypeId` (1 to 10) into the Stage 1 Outline prompt to enforce structural variety.

| # | Archetype Name | Pattern / Delivery Angle | Example Script Output |
| :--- | :--- | :--- | :--- |
| **1** | **The Teaser Hook** | Story summary $\rightarrow$ Caller/Line drop | *"Up next, a wild story about a 70% rent demand over a private bathroom. Alex from Wollongong is holding on Line 2."* |
| **2** | **The Hot-Take Lead** | Controversial question $\rightarrow$ Caller/Line drop | *"Is charging your roommate 70% of the rent ever justified? Alex from Wollongong is on Line 2 to make his case."* |
| **3** | **The Story Snapshot** | *"Imagine..."* scenario $\rightarrow$ Caller/Line drop | *"Imagine coming home to your roommate holding a tape measure and a spreadsheet. Alex from Wollongong is on Line 2..."* |
| **4** | **The Direct Jump-In** | Caller/Line drop first $\rightarrow$ Story summary | *"Line 2, we've got Alex from Wollongong. Alex is dealing with a roommate who thinks an en-suite bathroom means paying 70% rent..."* |
| **5** | **The Co-Host Banter Toss** | Host talks to Co-Host $\rightarrow$ Line drop | *"Sarah, you are not going to believe this one. Alex from Wollongong on Line 2 says his roommate just itemized their rent..."* |
| **6** | **The Moral Dilemma** | *"Would you ever..."* prompt $\rightarrow$ Caller/Line drop | *"Would you pay double rent just to keep peace with a friend? That's the mess Alex from Wollongong is sitting in on Line 2..."* |
| **7** | **The Incredulous Reaction** | Disbelief at screener board $\rightarrow$ Line drop | *"I'm looking at the board right now and I genuinely hope this is a joke. Alex from Wollongong on Line 2..."* |
| **8** | **The Audience Callout** | Speaks directly to listeners $\rightarrow$ Line drop | *"For anyone listening who has ever lived with a nightmare roommate, you need to hear this. Alex from Wollongong on Line 2..."* |
| **9** | **The SOS / Rescue Drop** | High urgency $\rightarrow$ Line drop | *"We need to help this guy out ASAP before he moves out. Alex from Wollongong is on Line 2, and his situation is spiraling..."* |
| **10** | **The Confession Lead** | Teases a secret/admission $\rightarrow$ Line drop | *"Alex from Wollongong is on Line 2 and he's about to admit to something most people would take to their grave..."* |
