-- Indexes for the queries the night leans on (the D1 free plan counts every
-- row read, so none of these may scan a table).

-- myVotes() reads a device's votes on every /contest poll.
CREATE INDEX votes_device ON votes (device);

-- recentLog() on every control-page poll.
CREATE INDEX log_at ON log (at);

-- The cron's two queries. Partial, so they stay tiny: only entries that still need work.
CREATE INDEX entries_to_check ON entries (created_at)
  WHERE copy_id IS NOT NULL AND removed_at IS NULL AND check_state IN ('pending', 'error');

CREATE INDEX entries_need_copy ON entries (created_at)
  WHERE drive_id IS NOT NULL AND copy_id IS NULL AND removed_at IS NULL;
