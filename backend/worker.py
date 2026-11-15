import logging
import time
from psycopg.types.json import Jsonb
from dataset import DATA_UNAVAILABLE, load
from main import Pair, db, evidence

logging.basicConfig(level=logging.INFO)
observations = load()
while True:
    try:
        with db() as conn:
            conn.execute("""UPDATE jobs SET status='failed',result='{"error":"Worker timed out"}'
                         WHERE status='running' AND started_at < now()-interval '10 minutes'""")
            job = conn.execute("""UPDATE jobs SET status='running',started_at=now()
            WHERE id=(SELECT id FROM jobs WHERE status='queued' ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED)
            RETURNING id,request""").fetchone()
        if not job:
            time.sleep(1)
            continue
        if not observations[0]:
            result, status = {"error": DATA_UNAVAILABLE}, "failed"
        else:
            try:
                result = evidence(*observations, Pair.model_validate(job[1]))
                status = "complete"
            except Exception:
                logging.exception("Analysis job %s failed", job[0])
                result, status = {"error": "Analysis failed"}, "failed"
        with db() as conn:
            conn.execute("UPDATE jobs SET status=%s,result=%s WHERE id=%s AND status='running'",
                         (status,Jsonb(result),job[0]))
    except Exception:
        logging.exception("Worker unavailable")
        time.sleep(3)
