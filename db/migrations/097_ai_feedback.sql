-- Migration 097: thumbs up/down feedback on AI suggestions
--
-- One row per rating. Deliberately no free text and no prompt/response
-- content: only the suggestion's stable hash id, its kind and the mode
-- that produced it, so the table cannot hold PII.

BEGIN;

CREATE TABLE IF NOT EXISTS ai_suggestion_feedback (
    feedback_id   SERIAL PRIMARY KEY,
    suggestion_id VARCHAR(64) NOT NULL,
    kind          VARCHAR(20) NOT NULL,   -- 'replenish', 'expiry', 'cycle_count'
    mode          VARCHAR(10) NOT NULL,   -- 'llm', 'rules'
    rating        SMALLINT    NOT NULL CHECK (rating IN (-1, 1)),
    user_id       INT REFERENCES users(user_id),
    warehouse_id  INT,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_ai_suggestion_feedback_created
    ON ai_suggestion_feedback(created_at);

COMMIT;
