CREATE TABLE IF NOT EXISTS inspection_members (
 account_id bigint PRIMARY KEY REFERENCES accounts(id),
 role text NOT NULL CHECK (role IN ('reviewer', 'inspector'))
);

CREATE TABLE IF NOT EXISTS inspections (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 created_by bigint NOT NULL REFERENCES accounts(id),
 assigned_to bigint REFERENCES accounts(id),
 title text NOT NULL,
 site text,
 status text NOT NULL DEFAULT 'review' CHECK (status IN ('review', 'assigned', 'submitted', 'closed')),
 evidence jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((status = 'review') = (assigned_to IS NULL)),
 CHECK ((status = 'review') = (site IS NULL))
);

CREATE INDEX IF NOT EXISTS inspections_assigned ON inspections(assigned_to, id);

CREATE TABLE IF NOT EXISTS inspection_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 inspection_id bigint NOT NULL REFERENCES inspections(id),
 actor_id bigint NOT NULL REFERENCES accounts(id),
 action text NOT NULL CHECK (action IN ('created', 'assigned', 'submitted', 'returned', 'closed')),
 note text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inspection_events_case ON inspection_events(inspection_id, id);
