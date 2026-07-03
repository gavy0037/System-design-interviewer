# PRD --- AI System Design Interviewer

## Overview

### Problem

Students preparing for software engineering interviews lack a realistic
environment to practice adaptive system design interviews.

### Solution

An AI interviewer that simulates senior engineers from top product
companies. It asks adaptive questions, remembers previous answers,
introduces changing constraints, evaluates trade-offs, and generates a
detailed interview report.

## Target Users

-   College students
-   Placement candidates
-   Software engineers preparing for system design interviews

## Goals

-   Conduct realistic interviews
-   Adapt questioning based on candidate responses
-   Evaluate design decisions and trade-offs
-   Generate actionable feedback

## Non-Goals

-   Teaching system design from scratch
-   Solving DSA problems
-   Automatically generating complete architectures

## Functional Requirements

### User Management

-   Sign up / Login
-   Interview history
-   Progress tracking

### Interview Configuration

-   Company persona (Google, Meta, Amazon, etc.)
-   Difficulty (Intern, SDE-1, SDE-2, Senior)
-   Topic (URL Shortener, Chat System, Cache, etc.)
-   Text or Voice mode

### Interview Flow

1.  Introduction
2.  Requirements Gathering
3.  High-Level Design
4.  Deep Dive
5.  Scaling Discussion
6.  Failure Scenarios
7.  Trade-offs
8.  Wrap-up

### Adaptive Interviewing

-   Ask follow-up questions based on previous answers.
-   Increase difficulty if the candidate performs well.
-   Challenge incorrect assumptions.

### Voice Support (Phase 2)

-   Speech-to-text
-   Streaming responses
-   Text-to-speech

### Evaluation

Score: - Requirement gathering - Communication - Database choices -
Scalability - Reliability - Caching - Networking - Trade-offs

### Progress Tracking

-   Interview history
-   Weak topics
-   Improvement over time

## Technical Stack

-   FastAPI
-   PostgreSQL
-   Redis
-   WebSockets
-   Gemini API
-   Docker

## Architecture

Frontend → Backend API → Interview Orchestrator → Conversation State →
LLM → Evaluation Engine → Database

## MVP

-   Text interview
-   Adaptive questioning
-   Evaluation
-   Report generation

Voice is added after the MVP.

## Future Scope

-   Company-specific interview styles
-   Whiteboard support
-   Diagram generation
-   Multi-agent interviewers

## Resume Value

Demonstrates: - Backend engineering - LLM orchestration - Prompt
engineering - Stateful conversations - WebSockets - AI application
design
