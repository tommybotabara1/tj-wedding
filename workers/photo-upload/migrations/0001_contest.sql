-- The photo contest: moments (the six categories), entries (guest uploads),
-- votes, settings (operator switches) and a log of operator actions.

CREATE TABLE moments (
  id TEXT PRIMARY KEY,
  sort INTEGER NOT NULL,
  title TEXT NOT NULL,
  hint TEXT NOT NULL,
  brief TEXT NOT NULL,
  phase TEXT NOT NULL DEFAULT 'entries',   -- entries | voting | closed | revealed
  shortlist TEXT NOT NULL DEFAULT '[]',    -- JSON array of entry ids
  winner TEXT                              -- an entry id, 'none' or NULL
);

CREATE TABLE entries (
  id TEXT PRIMARY KEY,
  device TEXT NOT NULL,
  guest TEXT NOT NULL DEFAULT '',
  moment TEXT REFERENCES moments(id),
  kind TEXT NOT NULL,                      -- photo | video
  mime TEXT,
  size INTEGER,
  session_key TEXT UNIQUE,
  drive_id TEXT,
  copy_id TEXT,
  token_hash TEXT,
  check_state TEXT NOT NULL DEFAULT 'pending',  -- pending | shown | held | error
  check_tries INTEGER NOT NULL DEFAULT 0,
  copy_tries INTEGER NOT NULL DEFAULT 0,
  fit INTEGER,
  quality INTEGER,
  note TEXT,
  operator TEXT,                           -- NULL | shown | hidden
  removed_at INTEGER,
  practice INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX entries_removed_created ON entries (removed_at, created_at);
CREATE INDEX entries_moment ON entries (moment);

CREATE TABLE votes (
  moment TEXT NOT NULL,
  device TEXT NOT NULL,
  entry TEXT NOT NULL,
  practice INTEGER NOT NULL DEFAULT 0,
  at INTEGER NOT NULL,
  PRIMARY KEY (moment, device)
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE log (
  at INTEGER NOT NULL,
  by TEXT,
  what TEXT
);

INSERT INTO moments (id, sort, title, hint, brief) VALUES
  ('aisle', 1, 'Here comes the bride', 'Jeyan''s walk down the church aisle.',
   'The bride, Jeyan, walking down the church aisle in her wedding gown, often escorted; guests in pews, church interior.'),
  ('entrance', 2, 'The grand entrance', 'Tommy and Jeyan''s entrance to "I See the Light."',
   'The newlyweds Tommy and Jeyan making their grand entrance into the reception hall together.'),
  ('first-dance', 3, 'The first dance', '"I Was Made for Lovin'' You."',
   'The newlyweds dancing together on the reception floor.'),
  ('happy-tears', 4, 'Happy tears', 'The parents'' dances, the speeches, the toast and the family messages.',
   'An emotional moment: tears, hugs or laughter during the parents'' dances, speeches, a toast or family messages.'),
  ('showstopper', 5, 'Showstopper', 'The production number, the musical numbers, the Botabara Cousins and the TJR surprise.',
   'A stage performance at the reception: a production number, singers, musicians, dancers or a surprise act.'),
  ('groufie', 6, 'Groufie with the newlyweds', 'Your table''s group selfie with Tommy and Jeyan.',
   'A group selfie of guests together with the bride (wedding gown) and groom (formal wear).');
