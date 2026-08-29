-- Reverse of lex_ai_assistant.up.sql (§G4 legal AI assistant). The tables hold
-- only assistant conversation history — no legal record of its own — so
-- dropping them (indexes + RLS policies go with them) loses no case, contract,
-- consultation or request data. Messages are dropped first for clarity; the FK
-- would cascade anyway.
DROP TABLE IF EXISTS lex_ai_messages;
DROP TABLE IF EXISTS lex_ai_sessions;
