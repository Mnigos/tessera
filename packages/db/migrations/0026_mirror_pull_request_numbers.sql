-- Mirrored pull requests adopt GitHub's number. Renumber existing synced rows
-- to their mapping's external number; the offset pass sidesteps transient
-- collisions with the per-repository unique (repository_id, number) while
-- staying positive for pull_requests_number_check.
UPDATE pull_requests pr
SET number = m.external_number + 1000000
FROM github_pull_request_mappings m
WHERE m.pull_request_id = pr.id
  AND pr.number <> m.external_number;
--> statement-breakpoint
UPDATE pull_requests
SET number = number - 1000000
WHERE number > 1000000;
--> statement-breakpoint
UPDATE repository_pull_request_counters c
SET next_number = greatest(c.next_number, mx.max_number + 1)
FROM (
  SELECT repository_id, max(number) AS max_number
  FROM pull_requests
  GROUP BY repository_id
) mx
WHERE mx.repository_id = c.repository_id;
